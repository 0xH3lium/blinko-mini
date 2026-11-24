import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  BUCKETS, deleteCaptureFts, getCapture, getCaptureRow, getField, getFieldsForCapture, getReminder,
  getSetting, insertEdge, listRules, setCaptureTags, syncCaptureFts, upsertFieldValue, upsertReminder,
  type Bucket, type Capture, type CaptureStatus, type CaptureField, type EdgeRelation,
} from '../db/queries.js';
import { runDeterministic, nextDueAt } from './deterministic.js';
import { applyRulePatch, evaluateRules } from './rules.js';
import { emit } from '../services/events.service.js';

const DEFAULT_REMINDER_DELAY_MS = 4 * 3_600_000;

export interface ManualFieldInput { valueText?: string | null; valueNum?: number | null }
export interface ManualLinkInput { targetId: string; relation: EdgeRelation; note?: string | null }

export interface CreateCaptureManualInput {
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  tags?: string[];
  sourceUrl?: string | null;
  urlTitle?: string | null;
  urlExcerpt?: string | null;
  meta?: Record<string, unknown>;
  createdAt?: number;
  reminderDueAt?: number | null;
  recurrence?: string | null;
  expiresAt?: number | null;
  expireAction?: 'archive' | 'trash' | 'delete';
  triaged?: boolean;
  fields?: Record<string, ManualFieldInput | null>;
  links?: ManualLinkInput[];
  fetchUrl?: boolean;
}

export interface IngestCaptureAutoInput {
  content: string;
  tgMessageId?: number;
  tgChatId?: number;
  replyToTgMessageId?: number;
  skipUrlFetch?: boolean;
  forwarded?: Record<string, unknown>;
}

export interface PipelineResult {
  capture: Capture | undefined;
  bucket: Bucket | null;
  reminderDueAt: number | null;
  appended: boolean;
}

interface FieldWrite { valueText?: string | null; valueNum?: number | null; source?: CaptureField['source']; locked?: boolean }

function writeFields(db: Database.Database, captureId: string, fields: Record<string, FieldWrite>): void {
  for (const [name, value] of Object.entries(fields)) {
    const field = getField(db, name);
    if (!field) continue;
    const source = value.source ?? 'human';
    upsertFieldValue(db, captureId, field.id, {
      valueText: value.valueText ?? null, valueNum: value.valueNum ?? null,
      source, locked: value.locked ?? source === 'human',
    });
  }
}

export async function createCaptureManual(db: Database.Database, input: CreateCaptureManualInput): Promise<PipelineResult> {
  const id = nanoid();
  const now = Date.now();
  let sourceUrl = input.sourceUrl ?? null;
  let urlTitle = input.urlTitle ?? null;
  let urlExcerpt = input.urlExcerpt ?? null;
  if (input.fetchUrl === true && sourceUrl && (!urlTitle || !urlExcerpt)) {
    const { fetchReadable } = await import('./deterministic.js');
    const readable = await fetchReadable(sourceUrl);
    if (readable) {
      sourceUrl = readable.url;
      urlTitle = urlTitle || readable.title || null;
      urlExcerpt = urlExcerpt || readable.excerpt || null;
    }
  }
  const createdAt = input.createdAt ?? now;
  const meta = { ...(input.meta ?? {}) };
  db.prepare(
    `INSERT INTO captures
       (id, content, bucket, status, is_pinned, capture_mode, triaged, source_url, url_title, url_excerpt,
        meta, expires_at, expire_action, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.content, input.bucket, input.status, input.isPinned ? 1 : 0, input.triaged === false ? 0 : 1,
    sourceUrl, urlTitle, urlExcerpt, JSON.stringify(meta), input.expiresAt ?? null, input.expireAction ?? 'archive', createdAt, now);

  db.transaction(() => {
    setCaptureTags(db, id, input.tags ?? []);
    writeFields(db, id, Object.fromEntries(Object.entries(input.fields ?? {}).filter(([, value]) => value !== null)) as Record<string, FieldWrite>);
    for (const link of input.links ?? []) {
      if (link.targetId === id || !getCaptureRow(db, link.targetId)) continue;
      insertEdge(db, id, link.targetId, link.relation, link.note ?? null);
    }
    if (input.reminderDueAt !== undefined && input.reminderDueAt !== null) {
      upsertReminder(db, id, { dueAt: input.reminderDueAt, state: 'pending', recurrence: input.recurrence ?? null });
    }
    syncCaptureFts(db, id);
  })();

  const capture = getCapture(db, id);
  emit('capture.created', capture);
  return { capture, bucket: input.bucket, reminderDueAt: input.reminderDueAt ?? null, appended: false };
}

/** Deterministic ingestion: micro-syntax → rules → tags/fields/ reminders/TTL/edges → FTS. No model calls. */
export async function ingestCaptureAuto(db: Database.Database, input: IngestCaptureAutoInput): Promise<PipelineResult> {
  const deterministic = await runDeterministic(input.content, new Date(), { db, skipUrlFetch: input.skipUrlFetch === true });

  if (deterministic.appendToLast || deterministic.linkToLast) {
    const last = db.prepare(
      "SELECT id FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).get() as { id: string } | undefined;
    if (last) {
      if (deterministic.appendToLast) {
        const previous = getCapture(db, last.id);
        const content = `${previous?.content ?? ''}\n${deterministic.text}`.trim();
        db.prepare('UPDATE captures SET content = ?, updated_at = ? WHERE id = ?').run(content, Date.now(), last.id);
        setCaptureTags(db, last.id, [...new Set([...(previous?.tags ?? []), ...deterministic.tags])]);
        syncCaptureFts(db, last.id);
        emit('capture.updated', getCapture(db, last.id));
        return { capture: getCapture(db, last.id), bucket: null, reminderDueAt: null, appended: true };
      }
    }
  }

  const id = nanoid();
  const now = Date.now();
  const bucketHint = deterministic.bucketHint;
  const meta: Record<string, unknown> = { ...deterministic.meta };
  if (input.forwarded) meta.forwarded = input.forwarded;
  db.prepare(
    `INSERT INTO captures
       (id, content, bucket, status, is_pinned, capture_mode, triaged, source_url, url_title, url_excerpt,
        meta, expires_at, expire_action, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, 'auto', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, deterministic.text, bucketHint ?? 'idea', deterministic.isPinned ? 1 : 0,
    deterministic.sourceUrl, deterministic.urlTitle, deterministic.urlExcerpt, JSON.stringify(meta),
    deterministic.expiresAt, deterministic.expireAction, now, now);

  db.transaction(() => {
    setCaptureTags(db, id, deterministic.tags);
    if (input.tgMessageId !== undefined && input.tgChatId !== undefined) {
      db.prepare('INSERT OR REPLACE INTO telegram_messages (tg_message_id, tg_chat_id, capture_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.tgMessageId, input.tgChatId, id, 'input', now);
    }
    if (input.replyToTgMessageId !== undefined) {
      const parent = db.prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?').get(input.replyToTgMessageId) as { capture_id: string } | undefined;
      if (parent && parent.capture_id !== id) insertEdge(db, id, parent.capture_id, 'reply', null);
    }
    if (deterministic.linkToLast) {
      const last = db.prepare('SELECT id FROM captures WHERE id <> ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1').get(id) as { id: string } | undefined;
      if (last) insertEdge(db, id, last.id, 'refines', '^ link');
    }
    if (input.forwarded) setCaptureTags(db, id, [...deterministic.tags, 'forwarded']);
  })();

  writeFields(db, id, deterministic.fields);
  const captureNow = getCapture(db, id)!;
  const { patch } = evaluateRules(listRules(db), {
    content: captureNow.content, tags: captureNow.tags, bucket: captureNow.bucket,
    explicitBucket: Boolean(bucketHint), sourceUrl: captureNow.sourceUrl, hasDue: Boolean(deterministic.parsedDueAt),
  });
  db.transaction(() => {
    applyRulePatch(db, id, patch);
    for (const rule of listRules(db)) {
      const { matchedRules } = evaluateRules([rule], {
        content: captureNow.content, tags: captureNow.tags, bucket: captureNow.bucket,
        explicitBucket: Boolean(bucketHint), sourceUrl: captureNow.sourceUrl,
      });
      if (matchedRules.length) db.prepare('UPDATE rules SET hit_count = hit_count + 1, updated_at = ? WHERE id = ?').run(Date.now(), rule.id);
    }
  })();

  const final = getCapture(db, id)!;
  let reminderDueAt = deterministic.parsedDueAt ?? (deterministic.recurrence ? nextDueAt(deterministic.recurrence) : null);
  if (!reminderDueAt && (final.bucket === 'reminder' || bucketHint === 'reminder')) {
    const hours = Number(getSetting(db, 'default_reminder_hours', '4'));
    reminderDueAt = now + (Number.isFinite(hours) ? hours : 4) * 3_600_000;
  }
  if (reminderDueAt) upsertReminder(db, id, { dueAt: reminderDueAt, recurrence: deterministic.recurrence, state: 'pending' });
  syncCaptureFts(db, id);

  const capture = getCapture(db, id);
  emit('capture.created', capture);
  return { capture, bucket: capture?.bucket ?? null, reminderDueAt, appended: false };
}

/** Split a multi-note dump into atomic captures in a single transaction. */
export async function ingestBatch(db: Database.Database, rawText: string, delimiter = '\n\n'): Promise<{ created: number; captures: Capture[] }> {
  const notes = rawText.split(delimiter).map((note) => note.trim()).filter(Boolean);
  const results: Capture[] = [];
  db.exec('BEGIN');
  try {
    for (const note of notes) {
      const result = await ingestCaptureAuto(db, { content: note, skipUrlFetch: true });
      if (result.capture) results.push(result.capture);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  emit('capture.bulk', { created: results.length });
  return { created: results.length, captures: results };
}

export interface MergeInput { survivorId: string; absorbIds: string[]; mergedContent?: string }

/** Stitch captures: union tags, prefer survivor/human fields, repoint edges, soft-delete absorbed rows. */
export function mergeCaptures(db: Database.Database, input: MergeInput): Capture | undefined {
  const survivor = getCapture(db, input.survivorId);
  if (!survivor) return undefined;
  const absorbed = input.absorbIds.map((id) => getCapture(db, id)).filter((capture): capture is Capture => capture !== undefined && capture.id !== input.survivorId);
  db.transaction(() => {
    const content = input.mergedContent ?? [survivor.content, ...absorbed.map((capture) => capture.content)].filter(Boolean).join('\n\n');
    const tags = [...new Set([survivor.tags, ...absorbed.map((capture) => capture.tags)].flat())];
    const mergedFrom = [...new Set([...(Array.isArray(survivor.meta.mergedFrom) ? survivor.meta.mergedFrom as string[] : []), ...absorbed.map((capture) => capture.id)])];
    db.prepare('UPDATE captures SET content = ?, meta = ?, updated_at = ? WHERE id = ?')
      .run(content, JSON.stringify({ ...survivor.meta, mergedFrom }), Date.now(), survivor.id);
    setCaptureTags(db, survivor.id, tags);

    for (const capture of absorbed) {
      for (const [name, field] of Object.entries(capture.fields)) {
        const current = getFieldsForCapture(db, survivor.id)[name];
        if (!current || (!current.locked && field.locked) || (current.source === 'rule' && field.source !== 'rule')) {
          upsertFieldValue(db, survivor.id, field.fieldId, {
            valueText: field.valueText, valueNum: field.valueNum, source: field.source, locked: field.locked,
          });
        }
      }
      const edges = db.prepare('SELECT source_id, target_id, relation, note FROM capture_edges WHERE source_id = ? OR target_id = ?').all(capture.id, capture.id) as Array<{
        source_id: string; target_id: string; relation: EdgeRelation; note: string | null;
      }>;
      db.prepare('DELETE FROM capture_edges WHERE source_id = ? OR target_id = ?').run(capture.id, capture.id);
      for (const edge of edges) {
        const source = edge.source_id === capture.id ? survivor.id : edge.source_id;
        const target = edge.target_id === capture.id ? survivor.id : edge.target_id;
        insertEdge(db, source, target, edge.relation, edge.note);
      }
      db.prepare('UPDATE captures SET deleted_at = ? WHERE id = ?').run(Date.now(), capture.id);
      deleteCaptureFts(db, capture.id);
    }
    syncCaptureFts(db, survivor.id);
  })();
  const merged = getCapture(db, survivor.id);
  emit('capture.bulk', { merged: merged?.id, absorbed: absorbed.map((capture) => capture.id) });
  return merged;
}

/** Re-run deterministic extraction and rules after a Telegram edit; never touches human-locked fields. */
export async function reextractEdited(db: Database.Database, captureId: string, text: string): Promise<Capture | undefined> {
  const existing = getCapture(db, captureId);
  if (!existing) return undefined;
  const parsed = await runDeterministic(text, new Date(), { db, skipUrlFetch: true });
  const locked = Object.fromEntries(Object.entries(getFieldsForCapture(db, captureId)).filter(([, field]) => field.locked).map(([name, field]) => [name, field]));
  const { patch } = evaluateRules(listRules(db), {
    content: parsed.text, tags: parsed.tags, bucket: parsed.bucketHint ?? existing.bucket,
    explicitBucket: Boolean(parsed.bucketHint), sourceUrl: parsed.sourceUrl ?? existing.sourceUrl,
  });
  db.transaction(() => {
    const sets: string[] = ['content = ?', 'updated_at = ?'];
    const params: unknown[] = [parsed.text, Date.now()];
    if (parsed.bucketHint && BUCKETS.includes(parsed.bucketHint)) { sets.push('bucket = ?'); params.push(parsed.bucketHint); }
    if (parsed.expiresAt !== null) { sets.push('expires_at = ?'); params.push(parsed.expiresAt); }
    params.push(captureId);
    db.prepare(`UPDATE captures SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    setCaptureTags(db, captureId, [...new Set([...parsed.tags, ...(patch.addTags ?? [])])]);
    applyRulePatch(db, captureId, { ...patch, fields: Object.fromEntries(Object.entries(patch.fields ?? {}).filter(([name]) => !locked[name])) });
    if (parsed.parsedDueAt || parsed.recurrence) {
      upsertReminder(db, captureId, {
        dueAt: parsed.parsedDueAt ?? nextDueAt(parsed.recurrence ?? '') ?? Date.now(),
        recurrence: parsed.recurrence, state: 'pending', keepRecurrence: true,
      });
    }
    syncCaptureFts(db, captureId);
  })();
  const updated = getCapture(db, captureId);
  emit('capture.updated', updated);
  return updated;
}
