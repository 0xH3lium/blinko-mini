export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < 45_000) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function fullTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function plural(value: number, singular: string, pluralForm?: string): string {
  return `${value} ${value === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

const TAG_PATTERN = /(?:^|\s)#([a-zA-Z0-9_-]{1,50})/g;
const VALID_TAG = /^[a-z0-9_-]{1,50}$/;

export function extractHashtags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of content.matchAll(TAG_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag) tags.add(tag);
  }
  return [...tags];
}

export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, '').toLowerCase();
  return VALID_TAG.test(tag) ? tag : null;
}

export function firstLineTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || 'Untitled').slice(0, 120);
}

export const TAG_HINT = '#tag';
