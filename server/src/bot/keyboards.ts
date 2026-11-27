import { InlineKeyboard } from 'grammy';
import { BUCKETS, type Bucket, type Capture } from '../db/queries.js';

export const BUCKET_EMOJI: Record<Bucket, string> = {
  idea: '🤯', memory: '🤔', reminder: '🙏', question: '👀', reference: '👌', noise: '😎',
};

export const BUCKET_LABELS: Record<Bucket, string> = {
  idea: 'idea', memory: 'memory', reminder: 'reminder', question: 'question', reference: 'reference', noise: 'noise',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Cached per timezone; owner timezone rarely changes. */
export function formatTime(ts: number, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
    formatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(ts));
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Callback payloads are capped at 64 bytes by Telegram; ids are nanoid(21), ops are short. */
export function splitCallback(data: string): { action: string; rest: string[] } {
  const [action = '', ...rest] = data.split(':');
  return { action, rest };
}

function addBucketRows(kb: InlineKeyboard, current: Bucket | null, prefix: string, perRow = 3, suffix = ''): void {
  BUCKETS.forEach((bucket, index) => {
    kb.text(`${BUCKET_EMOJI[bucket]}${bucket === current ? ' ●' : ''}`, `${prefix}:${bucket}${suffix}`);
    if ((index + 1) % perRow === 0) kb.row();
  });
  if (BUCKETS.length % perRow !== 0) kb.row();
}

/** Per-capture action keyboard: bucket switch, pin/triage/resolve, trash+undo, remind, refresh, close. */
export function captureKeyboard(capture: Capture): InlineKeyboard {
  const kb = new InlineKeyboard();
  addBucketRows(kb, capture.bucket, `cap:${capture.id}:bucket`);
  kb.text(capture.isPinned ? '📌 Unpin' : '📌 Pin', `cap:${capture.id}:pin`)
    .text(capture.status === 'resolved' ? '↩️ Reopen' : '✅ Resolve', `cap:${capture.id}:resolve`)
    .text('🗑 Trash', `cap:${capture.id}:trash`)
    .row()
    .text(capture.triaged ? '✅ Triaged' : '📥 Triage', `cap:${capture.id}:triage`)
    .text(leverageLabel(capture), `cap:${capture.id}:leverage`)
    .text(capture.reminder ? '⏰ Reminder' : '⏰ Set reminder', `cap:${capture.id}:remind`)
    .row()
    .text('🔄 Refresh', `cap:${capture.id}:open`)
    .text('✖ Close', `cap:${capture.id}:close`);
  return kb;
}

function leverageLabel(capture: Capture): string {
  const value = capture.fields.leverage?.valueNum;
  return `🔥 L${value ?? 0}`;
}

/** Soft-trash confirmation with one-tap undo. */
export function undoTrashKeyboard(captureId: string): InlineKeyboard {
  return new InlineKeyboard().text('↩️ Undo', `cap:${captureId}:restore`);
}

/** Reminder quick actions; keyboard stays live after each action. */
export function reminderKeyboard(captureId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Done ✓', `rem:${captureId}:done`)
    .text('Snooze +1h', `rem:${captureId}:snooze1`)
    .text('+4h', `rem:${captureId}:snooze4`)
    .row()
    .text('Tomorrow 9am', `rem:${captureId}:tomorrow`)
    .text('+1w', `rem:${captureId}:week`)
    .text('Kill', `rem:${captureId}:kill`)
    .row()
    .text('🗂 Open card', `cap:${captureId}:open`)
    .text('✖ Close', `cap:${captureId}:close`);
}

/** One-at-a-time triage card. */
export function triageKeyboard(captureId: string, index: number, total: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  addBucketRows(kb, null, 'tri:bucket', 3, `:${captureId}`);
  kb.text('✅ Triaged', `tri:triaged:${captureId}`)
    .text('🗑 Trash', `tri:trash:${captureId}`)
    .text('⏭ Skip', `tri:skip:${captureId}`)
    .row()
    .text('⬅️', `tri:prev:${captureId}`)
    .text(`${Math.min(index + 1, total)}/${total}`, 'tri:noop')
    .text('➡️', `tri:next:${captureId}`)
    .row()
    .text('✖ Exit triage', 'tri:exit');
  return kb;
}

/** Search results page with per-item open + paging. */
export function searchKeyboard(items: Capture[], page: number, pageSize: number, total: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const capture of items) kb.text(truncate(capture.content, 48), `srch:open:${capture.id}`).row();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  kb.text('⬅️', `srch:page:${Math.max(0, page - 1)}`)
    .text(`${page + 1}/${pages}`, 'tri:noop')
    .text('➡️', `srch:page:${Math.min(pages - 1, page + 1)}`);
  return kb;
}

export function digestKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📥 Triage inbox', 'tri:start')
    .text('⏰ Reminders', 'cmd:remind')
    .row()
    .text('🔄 Refresh', 'dig:refresh');
}

/** Capture card text. */
export function renderCaptureCard(capture: Capture, timeZone: string): string {
  const lines: string[] = [];
  const flags = [
    capture.isPinned ? '📌' : null,
    capture.status === 'resolved' ? '✅ resolved' : null,
    capture.status === 'archived' ? '📦 archived' : null,
    capture.triaged ? '✔ triaged' : '📥 untriaged',
  ].filter(Boolean);
  lines.push(`${BUCKET_EMOJI[capture.bucket]} ${capture.bucket}${flags.length ? ` · ${flags.join(' · ')}` : ''}`);
  lines.push(truncate(capture.content, 600));
  if (capture.tags.length) lines.push(capture.tags.map((tag) => `#${tag}`).join(' '));
  const fields = Object.values(capture.fields)
    .map((field) => `${field.name}=${field.valueText ?? field.valueNum ?? ''}`)
    .filter((entry) => !entry.endsWith('='));
  if (fields.length) lines.push(`fields: ${fields.join(' · ')}`);
  if (capture.reminder) {
    const r = capture.reminder;
    lines.push(`⏰ due ${formatTime(r.dueAt, timeZone)}${r.recurrence ? ` · ↻ ${r.recurrence}` : ''}${r.snoozeCount ? ` · snoozed ${r.snoozeCount}×` : ''}`);
  }
  if (capture.sourceUrl) lines.push(`🔗 ${truncate(capture.sourceUrl, 120)}`);
  lines.push(`id ${capture.id} · ${formatTime(capture.createdAt, timeZone)}`);
  return lines.join('\n');
}

/** Triage card text. */
export function renderTriageCard(capture: Capture, index: number, total: number, timeZone: string): string {
  return `📥 Triage ${Math.min(index + 1, total)}/${total}\n\n${renderCaptureCard(capture, timeZone)}`;
}
