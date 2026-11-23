import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as chrono from 'chrono-node';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Bucket } from '../db/queries.js';
import { config } from '../config.js';

const HASHTAG_PATTERN = /(?:^|\s)#([a-zA-Z0-9_-]{1,50})/g;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/iu;

export interface DeterministicResult {
  text: string;
  tags: string[];
  bucketHint: Bucket | null;
  parsedDueAt: number | null;
  url: string | null;
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  manualBypass: boolean;
}

export function extractHashtags(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag) found.add(tag);
  }
  return [...found];
}

export function extractUrls(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(new RegExp(URL_PATTERN, 'gi'))) {
    if (match[0]) found.add(match[0]);
  }
  return [...found];
}

export function stripPrefixHint(content: string): {
  text: string;
  bucketHint: Bucket | null;
  manualBypass: boolean;
} {
  let text = content.trim();
  let manualBypass = false;
  let bucketHint: Bucket | null = null;

  if (/^!(?:m|raw)\s+/iu.test(text)) {
    manualBypass = true;
    text = text.replace(/^!(?:m|raw)\s+/iu, '');
  }

  const prefixes: Array<{ pattern: RegExp; bucket: Bucket }> = [
    { pattern: /^(?:!rem|remind)\s+/iu, bucket: 'reminder' },
    { pattern: /^mem:\s*/iu, bucket: 'memory' },
    { pattern: /^idea:\s*/iu, bucket: 'idea' },
    { pattern: /^q:\s*/iu, bucket: 'question' },
    { pattern: /^ref:\s*/iu, bucket: 'reference' },
  ];
  for (const prefix of prefixes) {
    if (prefix.pattern.test(text)) {
      bucketHint = prefix.bucket;
      text = text.replace(prefix.pattern, '');
      break;
    }
  }
  return { text: text.trim(), bucketHint, manualBypass };
}

function timezoneOffset(timeZone: string, date: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((item) => item.type === 'timeZoneName')?.value;
    const match = part?.match(/GMT([+-]\d{2}:\d{2})/);
    return match?.[1] ?? '+00:00';
  } catch {
    return '+00:00';
  }
}

export function parseDueAt(text: string, now = new Date()): number | null {
  const timezone = timezoneOffset(config.OWNER_TIMEZONE, now);
  const results = chrono.parse(text, { instant: now, timezone }, { forwardDate: true });
  for (const result of results) {
    const date = result.start.date();
    if (Number.isFinite(date.getTime()) && date.getTime() > now.getTime()) return date.getTime();
  }
  return null;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIPv4(address);
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('::ffff:127.') ||
    lower.startsWith('::ffff:10.') ||
    lower.startsWith('::ffff:192.168.')
  );
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported protocol');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    throw new Error('Blocked host');
  }
  const records = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => {
        throw new Error('DNS lookup failed');
      });
  if (records.length === 0) throw new Error('No DNS records');
  for (const record of records) {
    if (isBlockedAddress(record.address)) throw new Error('Blocked private address');
  }
  return url;
}

/** Fetch a URL with a 5s timeout, 500 KB body cap, and SSRF protection. */
export async function fetchReadable(rawUrl: string): Promise<{ url: string; title: string; excerpt: string } | null> {
  try {
    const safe = await assertSafeUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(safe, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'BlinkoOS/1.0 (+readability)' },
      });
      if (!response.ok) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 500_000) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      reader.cancel().catch(() => undefined);
      const html = Buffer.concat(chunks).subarray(0, 500_000).toString('utf8');
      const { document } = parseHTML(html);
      const article = new Readability(document as never).parse();
      const title = (article?.title || document.title || '').trim().slice(0, 300);
      const text = (article?.textContent || '').replace(/\s+/g, ' ').trim();
      return { url: safe.toString(), title, excerpt: text.slice(0, 600) };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function runDeterministic(
  content: string,
  now = new Date(),
  skipUrlFetch = false,
): Promise<DeterministicResult> {
  const { text, bucketHint, manualBypass } = stripPrefixHint(content);
  const tags = extractHashtags(text);
  const parsedDueAt = parseDueAt(text, now);
  const urls = extractUrls(text);
  const url = urls[0] ?? null;
  let sourceUrl: string | null = null;
  let urlTitle: string | null = null;
  let urlExcerpt: string | null = null;
  if (url) {
    sourceUrl = url;
    if (!skipUrlFetch) {
      const readable = await fetchReadable(url);
      if (readable) {
        sourceUrl = readable.url;
        urlTitle = readable.title || null;
        urlExcerpt = readable.excerpt || null;
      }
    }
  }
  return {
    text,
    tags,
    bucketHint,
    parsedDueAt,
    url,
    sourceUrl,
    urlTitle,
    urlExcerpt,
    meta: {},
    manualBypass,
  };
}
