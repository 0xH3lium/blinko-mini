import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as chrono from 'chrono-node';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type Database from 'better-sqlite3';
import type { Bucket, CustomField } from '../db/queries.js';
import { getSetting, listFields } from '../db/queries.js';
import { config } from '../config.js';

const HASHTAG_PATTERN = /(?:^|\s)#([\p{L}\p{N}_-]{1,50})/gu;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/iu;
const TZ = () => config.OWNER_TIMEZONE;

export interface InlineField {
  valueText: string | null;
  valueNum: number | null;
  source: 'syntax';
}

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
  isPinned: boolean;
  triaged: boolean;
  expiresAt: number | null;
  expireAction: 'archive' | 'trash' | 'delete';
  recurrence: string | null;
  appendToLast: boolean;
  linkToLast: boolean;
  fields: Record<string, InlineField>;
}

export function extractHashtags(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1]?.toLocaleLowerCase();
    if (tag) found.add(tag);
  }
  return [...found];
}

export function extractUrls(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(new RegExp(URL_PATTERN, 'giu'))) {
    if (match[0]) found.add(match[0]);
  }
  return [...found];
}

function stripPrefixHint(content: string): {
  text: string;
  bucketHint: Bucket | null;
  manualBypass: boolean;
  appendToLast: boolean;
  linkToLast: boolean;
} {
  let text = content.trim();
  let manualBypass = false;
  let appendToLast = false;
  let linkToLast = false;
  let bucketHint: Bucket | null = null;

  const modifiers: Array<[RegExp, () => void]> = [
    [/^\+\+\s+/iu, () => { appendToLast = true; }],
    [/^\^\s+/iu, () => { linkToLast = true; }],
  ];
  for (const [pattern, apply] of modifiers) {
    if (pattern.test(text)) { text = text.replace(pattern, ''); apply(); }
  }
  if (/^!(?:m|raw)\s+/iu.test(text)) { manualBypass = true; text = text.replace(/^!(?:m|raw)\s+/iu, ''); }

  const prefixes: Array<{ pattern: RegExp; bucket: Bucket }> = [
    { pattern: /^(?:!rem|remind)\s+/iu, bucket: 'reminder' },
    { pattern: /^(?:m|mem):\s*/iu, bucket: 'memory' },
    { pattern: /^(?:i|idea):\s*/iu, bucket: 'idea' },
    { pattern: /^q:\s*/iu, bucket: 'question' },
    { pattern: /^(?:r|ref):\s*/iu, bucket: 'reference' },
    { pattern: /^(?:n|noise):\s*/iu, bucket: 'noise' },
  ];
  for (const prefix of prefixes) {
    if (prefix.pattern.test(text)) {
      bucketHint = prefix.bucket;
      text = text.replace(prefix.pattern, '');
      break;
    }
  }
  return { text: text.trim(), bucketHint, manualBypass, appendToLast, linkToLast };
}

export { stripPrefixHint };

function timezoneOffset(timeZone: string, date: Date): number {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date).find((item) => item.type === 'timeZoneName')?.value;
    const match = part?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 3_600_000 + Number(match[3]) * 60_000);
  } catch {
    return 0;
  }
}

function localToUtc(local: number, timeZone: string): number {
  let utc = local - timezoneOffset(timeZone, new Date(local));
  utc = local - timezoneOffset(timeZone, new Date(utc));
  return utc;
}

export function zonedParts(date: Date, timeZone = TZ()): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const year = value('year');
    const month = value('month');
    const day = value('day');
    return { year, month, day, hour: value('hour'), minute: value('minute'), weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
  } catch {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), weekday: date.getDay() };
  }
}

/** Tomorrow at HH:MM in the owner's timezone (never the browser/server local timezone). */
export function tomorrowAt(hour = 9, minute = 0, now = new Date(), timeZone = TZ()): number {
  const { year, month, day } = zonedParts(now, timeZone);
  const local = Date.UTC(year, month - 1, day + 1, hour, minute, 0, 0);
  return localToUtc(local, timeZone);
}

export function nextDueAt(recurrence: string, from = Date.now(), timeZone = TZ()): number | null {
  const daily = /^daily@(\d{1,2}):(\d{2})$/i.exec(recurrence);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    const p = zonedParts(new Date(from), timeZone);
    const local = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
    const due = localToUtc(local, timeZone);
    return due > from ? due : tomorrowAt(hour, minute, new Date(from), timeZone);
  }
  const weekly = /^weekly:([a-z,-]+)@(\d{1,2}):(\d{2})$/i.exec(recurrence);
  if (weekly) {
    const days = new Map([['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6]]);
    const wanted = weekly[1]!.toLowerCase().split(',').map((day) => days.get(day.trim().slice(0, 3))).filter((value): value is number => value !== undefined);
    const hour = Number(weekly[2]);
    const minute = Number(weekly[3]);
    for (let offset = 0; offset <= 7; offset += 1) {
      const base = new Date(tomorrowAt(hour, minute, new Date(from + offset * 86_400_000), timeZone));
      const parts = zonedParts(base, timeZone);
      if (wanted.includes(parts.weekday)) return base.getTime();
    }
    return null;
  }
  const every = /^every:(\d+)([mhd])$/i.exec(recurrence);
  if (every) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[every[2]!.toLowerCase() as 'm' | 'h' | 'd']!;
    return from + Number(every[1]) * unit;
  }
  return null;
}

export function parseDueAt(text: string, now = new Date()): number | null {
  const offset = timezoneOffset(TZ(), now);
  const zone = `${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 3_600_000)).padStart(2, '0')}:${String(Math.floor((Math.abs(offset) % 3_600_000) / 60_000)).padStart(2, '0')}`;
  const results = chrono.parse(text, { instant: now, timezone: zone }, { forwardDate: true });
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
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('fe80') || lower.startsWith('::ffff:127.') || lower.startsWith('::ffff:10.') || lower.startsWith('::ffff:192.168.');
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported protocol');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') throw new Error('Blocked host');
  const records = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => { throw new Error('DNS lookup failed'); });
  if (records.length === 0) throw new Error('No DNS records');
  for (const record of records) if (isBlockedAddress(record.address)) throw new Error('Blocked private address');
  return url;
}

/** 5s timeout, 500 KB body cap, and SSRF validation on every redirect hop (max 3). */
export async function fetchReadable(rawUrl: string): Promise<{ url: string; title: string; excerpt: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    let current = await assertSafeUrl(rawUrl);
    let response: Response | undefined;
    for (let hop = 0; hop <= 3; hop += 1) {
      response = await fetch(current, {
        signal: controller.signal, redirect: 'manual',
        headers: { 'user-agent': 'BlinkoOS/2.0 (+readability)' },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location || hop === 3) return null;
      current = await assertSafeUrl(new URL(location, current).toString());
    }
    if (!response?.ok) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.byteLength; }
    }
    void reader.cancel().catch(() => undefined);
    const html = Buffer.concat(chunks).subarray(0, 500_000).toString('utf8');
    const { document } = parseHTML(html);
    const article = new Readability(document as never).parse();
    const title = (article?.title || document.title || '').trim().slice(0, 300);
    const text = (article?.textContent || '').replace(/\s+/g, ' ').trim();
    return { url: current.toString(), title, excerpt: text.slice(0, 600) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fieldValue(field: CustomField, raw: string): { valueText: string | null; valueNum: number | null } {
  if (field.fieldType === 'score') {
    const number = Number(raw);
    return { valueText: Number.isFinite(number) ? String(number) : null, valueNum: Number.isFinite(number) ? number : null };
  }
  if (field.fieldType === 'boolean') {
    const yes = /^(yes|true|1|on|داری|بله)$/i.test(raw);
    return { valueText: yes ? 'yes' : 'no', valueNum: yes ? 1 : 0 };
  }
  return { valueText: raw || null, valueNum: null };
}

function parseInlineFields(text: string, fields: CustomField[], enabled: boolean): { text: string; fields: Record<string, InlineField> } {
  const result: Record<string, InlineField> = {};
  let cleaned = text;
  if (enabled) {
    for (const field of fields) {
      if (field.alias) {
        const escaped = field.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`!${escaped}(?::|=)?([^\\s#!@]*)\\s*`, 'giu');
        cleaned = cleaned.replace(pattern, (_match, raw: string) => {
          const value = fieldValue(field, raw || (field.fieldType === 'boolean' ? 'yes' : ''));
          result[field.name] = { ...value, source: 'syntax' };
          return ' ';
        });
      }
      const name = field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const named = new RegExp(`@${name}\\s*:\\s*("[^"]+"|[^\\s#]+)\\s*`, 'giu');
      cleaned = cleaned.replace(named, (_match, raw: string) => {
        result[field.name] = { ...fieldValue(field, raw.replace(/^"|"$/g, '')), source: 'syntax' };
        return ' ';
      });
    }
  }
  return { text: cleaned, fields: result };
}

function parseRecurrenceToken(text: string): { text: string; recurrence: string | null; dueAt: number | null; expiresAt: number | null } {
  let cleaned = text;
  let recurrence: string | null = null;
  let dueAt: number | null = null;
  let expiresAt: number | null = null;

  cleaned = cleaned.replace(/!ttl\s+(\d+)\s*([mhd])\b/giu, (_match, count: string, unit: string) => {
    const ms = Number(count) * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[unit.toLowerCase() as 'm' | 'h' | 'd']!);
    expiresAt = Date.now() + ms;
    return ' ';
  });
  cleaned = cleaned.replace(/!every\s+(\d+)\s*([mhd])\b/giu, (_match, count: string, unit: string) => {
    recurrence = `every:${count}${unit.toLowerCase()}`;
    dueAt = nextDueAt(recurrence) ?? null;
    return ' ';
  });
  cleaned = cleaned.replace(/!every\s+(daily|day)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/giu, (_match, _day: string, hourRaw: string, minuteRaw: string | undefined, meridiem: string | undefined) => {
    let hour = Number(hourRaw);
    if (meridiem?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (meridiem?.toLowerCase() === 'am' && hour === 12) hour = 0;
    recurrence = `daily@${String(hour).padStart(2, '0')}:${minuteRaw ?? '00'}`;
    dueAt = nextDueAt(recurrence) ?? null;
    return ' ';
  });
  cleaned = cleaned.replace(/!every\s+([a-z]{3}(?:,[a-z]{3})*)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/giu, (_match, days: string, hourRaw: string, minuteRaw: string | undefined, meridiem: string | undefined) => {
    let hour = Number(hourRaw);
    if (meridiem?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (meridiem?.toLowerCase() === 'am' && hour === 12) hour = 0;
    recurrence = `weekly:${days.toLowerCase()}@${String(hour).padStart(2, '0')}:${minuteRaw ?? '00'}`;
    dueAt = nextDueAt(recurrence) ?? null;
    return ' ';
  });
  return { text: cleaned, recurrence, dueAt, expiresAt };
}

export interface DeterministicOptions {
  skipUrlFetch?: boolean;
  db?: Database.Database;
  now?: Date;
  fields?: CustomField[];
  inlineSyntax?: boolean;
}

export async function runDeterministic(
  content: string,
  now: Date = new Date(),
  options: DeterministicOptions = {},
): Promise<DeterministicResult> {
  const prefix = stripPrefixHint(content);
  const fields = options.fields ?? (options.db ? listFields(options.db, true) : []);
  const inlineEnabled = options.inlineSyntax ?? (options.db ? getSetting(options.db, 'inline_syntax_enabled', 'true') === 'true' : true);
  const inline = parseInlineFields(prefix.text, inlineEnabled ? fields : [], inlineEnabled);
  const recurrence = parseRecurrenceToken(inline.text);
  const isPinned = /!pin|📌/iu.test(recurrence.text);
  const cleaned = recurrence.text.replace(/!pin|📌/giu, ' ').replace(/\s+/gu, ' ').trim();

  const tags = extractHashtags(cleaned);
  const parsedDueAt = recurrence.dueAt ?? parseDueAt(cleaned, now);
  const url = extractUrls(cleaned)[0] ?? null;
  let sourceUrl: string | null = url;
  let urlTitle: string | null = null;
  let urlExcerpt: string | null = null;
  if (url && !options.skipUrlFetch) {
    const readable = await fetchReadable(url);
    if (readable) {
      sourceUrl = readable.url;
      urlTitle = readable.title || null;
      urlExcerpt = readable.excerpt || null;
    }
  }
  return {
    text: cleaned, tags, bucketHint: prefix.bucketHint, parsedDueAt, url, sourceUrl, urlTitle, urlExcerpt,
    meta: {}, manualBypass: prefix.manualBypass, isPinned, triaged: false, expiresAt: recurrence.expiresAt,
    expireAction: 'archive', recurrence: recurrence.recurrence, appendToLast: prefix.appendToLast, linkToLast: prefix.linkToLast,
    fields: inline.fields,
  };
}
