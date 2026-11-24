import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  BUCKETS, CAPTURE_STATUSES, EDGE_RELATIONS, deleteFieldValue, getCapture, getCaptureRow, getField,
  insertEdge, setCaptureTags, syncCaptureFts, upsertFieldValue, upsertReminder, type Bucket,
} from '../db/queries.js';
import { mergeCaptures } from './pipeline.js';
import { emit } from '../services/events.service.js';

const updateSchema = z.object({
  id: z.string().min(1),
  bucket: z.enum(BUCKETS as [Bucket, ...Bucket[]]).optional(),
  status: z.enum(CAPTURE_STATUSES as ['active', 'resolved', 'archived']).optional(),
  isPinned: z.boolean().optional(),
  triaged: z.boolean().optional(),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  reminderDueIso: z.string().optional(),
  links: z.array(z.object({
    targetId: z.string().min(1),
    relation: z.enum(EDGE_RELATIONS as ['reply', 'related', 'refines', 'supports', 'blocks', 'answers']),
    note: z.string().nullable().optional(),
  }).strict()).optional(),
}).strict();

export const patchSchema = z.object({
  updates: z.array(updateSchema).default([]),
  merges: z.array(z.object({
    survivorId: z.string().min(1), absorbIds: z.array(z.string().min(1)).min(1), mergedContent: z.string().optional(),
  }).strict()).default([]),
  newCaptures: z.array(z.object({
    content: z.string().min(1), bucket: z.enum(BUCKETS as [Bucket, ...Bucket[]]).default('idea'),
    tags: z.array(z.string()).default([]), sourceId: z.string().optional(),
  }).strict()).default([]),
});

export type ValidatedPatch = z.infer<typeof patchSchema>;

/** Accept raw LLM output, including ```json fences, and return the strict parsed patch. */
export function parsePatch(raw: string): { patch: ValidatedPatch; errors: string[] } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const json = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  let parsed: unknown;
  try { parsed = JSON.parse(json) as unknown; } catch { return { patch: { updates: [], merges: [], newCaptures: [] }, errors: ['No valid JSON object found in input'] }; }
  const result = patchSchema.safeParse(parsed);
  if (!result.success) return { patch: { updates: [], merges: [], newCaptures: [] }, errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'patch'}: ${issue.message}`) };
  return { patch: result.data, errors: [] };
}

function valueForField(value: string | number | boolean | null): { valueText: string | null; valueNum: number | null } {
  if (value === null) return { valueText: null, valueNum: null };
  if (typeof value === 'number') return { valueText: String(value), valueNum: value };
  if (typeof value === 'boolean') return { valueText: value ? 'yes' : 'no', valueNum: value ? 1 : 0 };
  const numeric = Number(value);
  return Number.isFinite(numeric) && value.trim() !== '' ? { valueText: value, valueNum: numeric } : { valueText: value, valueNum: null };
}

function sanitizePatch(db: Database.Database, patch: ValidatedPatch): { patch: ValidatedPatch; warnings: string[] } {
  const warnings: string[] = [];
  const updates = patch.updates.filter((update) => {
    if (!getCaptureRow(db, update.id)) { warnings.push(`Unknown capture id: ${update.id}`); return false; }
    if (update.links) for (const link of update.links) {
      if (link.targetId === update.id) warnings.push(`Skipped self-link on ${update.id}`);
      else if (!getCaptureRow(db, link.targetId)) warnings.push(`Unknown link target: ${link.targetId}`);
    }
    for (const name of Object.keys(update.fields ?? {})) {
      if (!getField(db, name)) warnings.push(`Unknown field: ${name}`);
    }
    return true;
  }).map((update) => ({
    ...update,
    links: update.links?.filter((link) => link.targetId !== update.id && Boolean(getCaptureRow(db, link.targetId))),
  }));
  const merges = patch.merges.filter((merge) => {
    if (!getCaptureRow(db, merge.survivorId)) { warnings.push(`Unknown survivor id: ${merge.survivorId}`); return false; }
    const valid = merge.absorbIds.filter((id) => {
      if (!getCaptureRow(db, id) || id === merge.survivorId) { warnings.push(`Unknown absorb id: ${id}`); return false; }
      return true;
    });
    return valid.length > 0;
  });
  return { patch: { ...patch, updates, merges }, warnings };
}

export interface PatchDiff {
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface PatchPreview {
  diffs: PatchDiff[];
  warnings: string[];
  updateCount: number;
  mergeCount: number;
  newCount: number;
  newItems: Array<{ key: string; content: string; bucket: string; tags: string[] }>;
}

function beforeState(db: Database.Database, id: string): Record<string, unknown> {
  const capture = getCapture(db, id);
  if (!capture) return {};
  return {
    content: capture.content, bucket: capture.bucket, status: capture.status, isPinned: capture.isPinned,
    triaged: capture.triaged, tags: capture.tags,
    fields: Object.fromEntries(Object.values(capture.fields).map((field) => [field.name, field.valueText ?? field.valueNum])),
    reminder: capture.reminder?.dueAt ?? null,
    links: (db.prepare('SELECT target_id, relation FROM capture_edges WHERE source_id = ?').all(id) as Array<{ target_id: string; relation: string }>).map((row) => `${row.relation}:${row.target_id}`),
  };
}

export function previewPatch(db: Database.Database, raw: string): PatchPreview & { errors: string[] } {
  const parsed = parsePatch(raw);
  const { patch, warnings } = sanitizePatch(db, parsed.patch);
  const diffs: PatchDiff[] = [];
  for (const update of patch.updates) {
    const before = beforeState(db, update.id);
    const removed = new Set(update.removeTags ?? []);
    const after: Record<string, unknown> = {
      ...before,
      ...(update.bucket ? { bucket: update.bucket } : {}),
      ...(update.status ? { status: update.status } : {}),
      ...(update.isPinned !== undefined ? { isPinned: update.isPinned } : {}),
      ...(update.triaged !== undefined ? { triaged: update.triaged } : {}),
      tags: [...new Set([...(before.tags as string[]).filter((tag) => !removed.has(tag)), ...(update.addTags ?? [])])],
      fields: { ...(before.fields as Record<string, unknown>), ...Object.fromEntries(Object.entries(update.fields ?? {}).map(([name, value]) => [name, value])) },
      ...(update.reminderDueIso ? { reminder: Date.parse(update.reminderDueIso) } : {}),
      links: [...(before.links as string[]), ...(update.links ?? []).map((link) => `${link.relation}:${link.targetId}`)],
    };
    diffs.push({ id: update.id, before, after });
  }
  for (const merge of patch.merges) {
    diffs.push({ id: merge.survivorId, before: beforeState(db, merge.survivorId), after: { mergedFrom: merge.absorbIds, content: merge.mergedContent ?? '(union of source contents)' } });
  }
  return {
    diffs, warnings, errors: parsed.errors, updateCount: patch.updates.length,
    mergeCount: patch.merges.length, newCount: patch.newCaptures.length,
    newItems: patch.newCaptures.map((item, index) => ({ key: `new:${index}`, content: item.content, bucket: item.bucket, tags: item.tags })),
  };
}

export function applyPatch(db: Database.Database, patch: ValidatedPatch, selectedIds?: string[]): {
  affected: number; merges: number; created: number; warnings: string[];
} {
  const clean = sanitizePatch(db, patch);
  const updates = selectedIds ? clean.patch.updates.filter((update) => selectedIds.includes(update.id)) : clean.patch.updates;
  const merges = selectedIds ? clean.patch.merges.filter((merge) => selectedIds.includes(merge.survivorId)) : clean.patch.merges;
  const newCaptures = selectedIds
    ? clean.patch.newCaptures.filter((_item, index) => selectedIds.includes(`new:${index}`))
    : clean.patch.newCaptures;
  const created = newCaptures.length;
  let mergeCount = 0;
  db.transaction(() => {
    for (const update of updates) {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); params.push(value); };
      if (update.bucket) set('bucket', update.bucket);
      if (update.status) set('status', update.status);
      if (update.isPinned !== undefined) set('is_pinned', update.isPinned ? 1 : 0);
      if (update.triaged !== undefined) set('triaged', update.triaged ? 1 : 0);
      if (sets.length) {
        set('updated_at', Date.now());
        db.prepare(`UPDATE captures SET ${sets.join(', ')} WHERE id = ?`).run(...params, update.id);
      }
      if (update.addTags?.length || update.removeTags?.length) {
        const current = getCapture(db, update.id)?.tags ?? [];
        const removed = new Set(update.removeTags ?? []);
        setCaptureTags(db, update.id, [...new Set([...current.filter((tag) => !removed.has(tag)), ...(update.addTags ?? [])])]);
      }
      for (const [name, value] of Object.entries(update.fields ?? {})) {
        const field = getField(db, name);
        if (!field) continue;
        if (value === null) { deleteFieldValue(db, update.id, field.id); continue; }
        const parsed = valueForField(value);
        upsertFieldValue(db, update.id, field.id, { ...parsed, source: 'patch' });
      }
      if (update.reminderDueIso) {
        const dueAt = Date.parse(update.reminderDueIso);
        if (Number.isFinite(dueAt)) upsertReminder(db, update.id, { dueAt, state: 'pending', keepRecurrence: true });
      }
      for (const link of update.links ?? []) {
        if (link.targetId === update.id || !getCaptureRow(db, link.targetId)) continue;
        insertEdge(db, update.id, link.targetId, link.relation, link.note ?? null);
      }
      syncCaptureFts(db, update.id);
    }
    for (const merge of merges) {
      mergeCaptures(db, { survivorId: merge.survivorId, absorbIds: merge.absorbIds, mergedContent: merge.mergedContent });
      mergeCount += 1;
    }
    if (created) {
      for (const item of newCaptures) {
        const id = nanoid();
        const now = Date.now();
        db.prepare(
          `INSERT INTO captures (id, content, bucket, status, is_pinned, capture_mode, triaged, meta, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 0, 'auto', 1, '{"source":"patch"}', ?, ?)`,
        ).run(id, item.content, item.bucket, now, now);
        setCaptureTags(db, id, item.tags);
        if (item.sourceId && getCaptureRow(db, item.sourceId)) insertEdge(db, id, item.sourceId, 'refines', 'extracted from patch');
        syncCaptureFts(db, id);
      }
    }
  })();
  const result = { affected: updates.length, merges: mergeCount, created, warnings: clean.warnings };
  emit('capture.bulk', result);
  return result;
}
