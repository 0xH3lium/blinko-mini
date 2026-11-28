import type Database from 'better-sqlite3';
import {
  BUCKETS, CAPTURE_STATUSES, captureFromRow, deleteCaptureFts, deleteFieldValue, deleteOrphanTags,
  getCapture, getCaptureRow, getFieldsForCapture, getField, getReminder, getSetting, listCaptures, listTags, setCaptureTags, syncCaptureFts,
  upsertFieldValue, upsertReminder,
  type Bucket, type Capture, type CaptureFilters, type CapturePage, type CaptureStatus,
  type EdgeRelation, type FieldSource,
} from '../db/queries.js';
import { fetchReadable, nextDueAt, tomorrowAt } from '../engine/deterministic.js';
import { insertEdge, deleteEdge } from '../db/queries.js';
import { emit } from './events.service.js';

export class ServiceError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 400) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface FieldPatch {
  valueText?: string | null;
  valueNum?: number | null;
  source?: FieldSource;
}

export interface UpdateCaptureInput {
  content?: string;
  bucket?: Bucket;
  status?: CaptureStatus;
  isPinned?: boolean;
  captureMode?: 'auto' | 'manual';
  triaged?: boolean;
  touch?: boolean;
  expiresAt?: number | null;
  expireAction?: 'archive' | 'trash' | 'delete';
  deletedAt?: number | null;
  tags?: string[];
  sourceUrl?: string | null;
  urlTitle?: string | null;
  urlExcerpt?: string | null;
  meta?: Record<string, unknown>;
  createdAt?: number;
  reminder?: {
    dueAt: number;
    state?: 'pending' | 'notified' | 'done' | 'killed';
    snoozeCount?: number;
    recurrence?: string | null;
  } | null;
  fields?: Record<string, FieldPatch | null>;
}

export type BulkAction =
  | { type: 'bucket'; value: Bucket }
  | { type: 'status'; value: CaptureStatus }
  | { type: 'isPinned'; value: boolean }
  | { type: 'triaged'; value: boolean }
  | { type: 'addTags'; value: string[] }
  | { type: 'removeTags'; value: string[] }
  | { type: 'setField'; name: string; value: string | number | boolean | null }
  | { type: 'trash' }
  | { type: 'restore' };

export type ReminderAction = 'done' | 'snooze1' | 'snooze4' | 'tomorrow' | 'week' | 'kill';

export class CapturesService {
  constructor(readonly db: Database.Database) {}

  list(filters: CaptureFilters = {}): CapturePage { return listCaptures(this.db, filters); }

  get(id: string): Capture | undefined { return getCapture(this.db, id); }

  tags(includeDeleted = false): Array<{ name: string; count: number }> { return listTags(this.db, includeDeleted); }

  update(id: string, patch: UpdateCaptureInput): Capture | undefined {
    const current = getCaptureRow(this.db, id);
    if (!current) return undefined;
    if (patch.content !== undefined && !patch.content.trim()) throw new ServiceError('content must be non-empty');
    if (patch.bucket !== undefined && !BUCKETS.includes(patch.bucket)) throw new ServiceError('invalid bucket');
    if (patch.status !== undefined && !CAPTURE_STATUSES.includes(patch.status)) throw new ServiceError('invalid status');

    this.db.transaction(() => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); params.push(value); };
      if (patch.content !== undefined) set('content', patch.content);
      if (patch.bucket !== undefined) set('bucket', patch.bucket);
      if (patch.status !== undefined) set('status', patch.status);
      if (patch.isPinned !== undefined) set('is_pinned', patch.isPinned ? 1 : 0);
      if (patch.captureMode !== undefined) set('capture_mode', patch.captureMode);
      if (patch.triaged !== undefined) set('triaged', patch.triaged ? 1 : 0);
      if (patch.expiresAt !== undefined) set('expires_at', patch.expiresAt);
      if (patch.expireAction !== undefined) set('expire_action', patch.expireAction);
      if (patch.deletedAt !== undefined) set('deleted_at', patch.deletedAt);
      if (patch.sourceUrl !== undefined) set('source_url', patch.sourceUrl);
      if (patch.urlTitle !== undefined) set('url_title', patch.urlTitle);
      if (patch.urlExcerpt !== undefined) set('url_excerpt', patch.urlExcerpt);
      if (patch.meta !== undefined) set('meta', JSON.stringify(patch.meta));
      if (patch.createdAt !== undefined) set('created_at', patch.createdAt);
      if (patch.touch || sets.length) {
        if (!sets.includes('updated_at')) set('updated_at', Date.now());
        this.db.prepare(`UPDATE captures SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      }
      if (patch.tags !== undefined) {
        setCaptureTags(this.db, id, patch.tags);
        deleteOrphanTags(this.db);
      }
      if (patch.reminder !== undefined) {
        if (patch.reminder === null) this.db.prepare('DELETE FROM reminders WHERE capture_id = ?').run(id);
        else {
          const existing = getReminder(this.db, id);
          const future = patch.reminder.dueAt > Date.now();
          const terminal = patch.reminder.state === 'done' || patch.reminder.state === 'killed';
          upsertReminder(this.db, id, {
            dueAt: patch.reminder.dueAt,
            state: patch.reminder.state ?? (future && !terminal ? 'pending' : existing?.state ?? 'pending'),
            snoozeCount: patch.reminder.snoozeCount ?? existing?.snoozeCount ?? 0,
            recurrence: patch.reminder.recurrence ?? existing?.recurrence ?? null,
            lastNotifiedAt: existing?.lastNotifiedAt ?? null,
          });
        }
      }
      for (const [key, value] of Object.entries(patch.fields ?? {})) {
        const field = getField(this.db, key);
        if (!field) throw new ServiceError(`Unknown field: ${key}`, 404);
        if (value === null) { deleteFieldValue(this.db, id, field.id); continue; }
        upsertFieldValue(this.db, id, field.id, {
          valueText: value.valueText ?? null, valueNum: value.valueNum ?? null,
          source: value.source ?? 'human', locked: (value.source ?? 'human') === 'human',
        });
      }
      syncCaptureFts(this.db, id);
    })();
    const updated = getCapture(this.db, id);
    emit('capture.updated', updated);
    return updated;
  }

  /** Shared by bot callbacks, Agenda quick actions and Inspector. All timezone math is server-side. */
  reminderAction(id: string, action: ReminderAction): Capture | undefined {
    const reminder = getReminder(this.db, id);
    if (!reminder) return undefined;
    const timeZone = getSetting(this.db, 'owner_timezone', 'Asia/Tehran');
    let dueAt = reminder.dueAt;
    let state: 'pending' | 'notified' | 'done' | 'killed' = 'pending';
    let status: CaptureStatus | undefined;
    let snoozeCount = reminder.snoozeCount;

    if (action === 'done') {
      if (reminder.recurrence) {
        dueAt = nextDueAt(reminder.recurrence, Date.now(), timeZone) ?? dueAt + 86_400_000;
        snoozeCount = 0;
      } else {
        state = 'done';
        status = 'resolved';
      }
    } else if (action === 'kill') state = 'killed';
    else {
      const now = Date.now();
      if (action === 'snooze1') dueAt = now + 3_600_000;
      else if (action === 'snooze4') dueAt = now + 4 * 3_600_000;
      else if (action === 'tomorrow') dueAt = tomorrowAt(9, 0, new Date(now), timeZone);
      else if (action === 'week') dueAt = now + 7 * 86_400_000;
      snoozeCount += 1;
    }
    this.db.transaction(() => {
      upsertReminder(this.db, id, { dueAt, state, snoozeCount, recurrence: reminder.recurrence, lastNotifiedAt: null });
      if (status) this.db.prepare('UPDATE captures SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
    })();
    const updated = getCapture(this.db, id);
    emit('reminder.updated', { captureId: id, state, dueAt });
    emit('capture.updated', updated);
    return updated;
  }

  /** Soft-delete by default; permanent=true is handled by the route calling hardDelete. */
  remove(id: string): boolean {
    const result = this.db.prepare('UPDATE captures SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(Date.now(), Date.now(), id);
    if (result.changes > 0) emit('capture.deleted', { id });
    return result.changes > 0;
  }

  hardDelete(id: string): boolean {
    const run = this.db.transaction(() => {
      deleteCaptureFts(this.db, id);
      const result = this.db.prepare('DELETE FROM captures WHERE id = ?').run(id);
      if (result.changes > 0) deleteOrphanTags(this.db);
      return result.changes > 0;
    });
    const removed = run();
    if (removed) emit('capture.deleted', { id });
    return removed;
  }

  restore(id: string): boolean {
    const restored = this.db.transaction(() => {
      const result = this.db.prepare('UPDATE captures SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL').run(Date.now(), id);
      if (result.changes > 0) syncCaptureFts(this.db, id);
      return result.changes > 0;
    })();
    if (restored) emit('capture.restored', { id });
    return restored;
  }

  addEdge(sourceId: string, targetId: string, relation: EdgeRelation, note?: string | null): void {
    if (sourceId === targetId) throw new ServiceError('A capture cannot link to itself');
    if (!getCaptureRow(this.db, sourceId) || !getCaptureRow(this.db, targetId)) throw new ServiceError('Capture not found', 404);
    insertEdge(this.db, sourceId, targetId, relation, note ?? null);
    emit('edge.updated', { sourceId, targetId, relation });
  }

  removeEdge(sourceId: string, targetId: string, relation: EdgeRelation): void {
    deleteEdge(this.db, sourceId, targetId, relation);
    emit('edge.updated', { sourceId, targetId, relation, removed: true });
  }

  async fetchUrlMetadata(id: string, url?: string): Promise<Capture | undefined> {
    const capture = getCapture(this.db, id);
    if (!capture) return undefined;
    const target = url ?? capture.sourceUrl;
    if (!target) throw new ServiceError('No source URL to fetch');
    const readable = await fetchReadable(target);
    if (!readable) throw new ServiceError('Could not fetch a readable article from that URL');
    this.db.prepare('UPDATE captures SET source_url = ?, url_title = ?, url_excerpt = ?, updated_at = ? WHERE id = ?')
      .run(readable.url, readable.title, readable.excerpt, Date.now(), id);
    syncCaptureFts(this.db, id);
    const updated = getCapture(this.db, id);
    emit('capture.updated', updated);
    return updated;
  }

  bulkAction(ids: string[], action: BulkAction): { affected: number } {
    const existing = ids.filter((id) => getCaptureRow(this.db, id) !== undefined);
    let impacted: string[] = [];
    this.db.transaction(() => {
      if (action.type === 'trash') {
        impacted = existing.filter((id) => this.db.prepare('UPDATE captures SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(Date.now(), Date.now(), id).changes > 0);
      } else if (action.type === 'restore') {
        impacted = existing.filter((id) => this.db.prepare('UPDATE captures SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes > 0);
        for (const id of impacted) syncCaptureFts(this.db, id);
      } else if (action.type === 'setField') {
        const field = getField(this.db, action.name);
        if (!field) throw new ServiceError(`Unknown field: ${action.name}`, 404);
        for (const id of existing) {
          if (getFieldsForCapture(this.db, id)[field.name]?.locked) continue;
          const text = action.value === null ? null : typeof action.value === 'number' ? String(action.value) : String(action.value);
          const numeric = typeof action.value === 'number' ? action.value : typeof action.value === 'boolean' ? (action.value ? 1 : 0) : Number(text);
          upsertFieldValue(this.db, id, field.id, { valueText: text, valueNum: Number.isFinite(numeric) ? numeric : null, source: 'human', locked: true });
        }
        impacted = existing;
      } else {
        for (const id of existing) {
          const capture = getCapture(this.db, id);
          if (!capture) continue;
          if (action.type === 'bucket') this.db.prepare('UPDATE captures SET bucket = ?, updated_at = ? WHERE id = ?').run(action.value, Date.now(), id);
          else if (action.type === 'status') this.db.prepare('UPDATE captures SET status = ?, updated_at = ? WHERE id = ?').run(action.value, Date.now(), id);
          else if (action.type === 'isPinned') this.db.prepare('UPDATE captures SET is_pinned = ?, updated_at = ? WHERE id = ?').run(action.value ? 1 : 0, Date.now(), id);
          else if (action.type === 'triaged') this.db.prepare('UPDATE captures SET triaged = ?, updated_at = ? WHERE id = ?').run(action.value ? 1 : 0, Date.now(), id);
          else if (action.type === 'addTags') setCaptureTags(this.db, id, [...new Set([...capture.tags, ...action.value])]);
          else if (action.type === 'removeTags') {
            const removed = new Set(action.value);
            setCaptureTags(this.db, id, capture.tags.filter((tag) => !removed.has(tag)));
          }
          syncCaptureFts(this.db, id);
        }
        impacted = existing;
      }
    })();
    emit('capture.bulk', { affected: impacted.length, ids: impacted, action: action.type });
    return { affected: impacted.length };
  }
}

let service: CapturesService | undefined;

export function getCapturesService(): CapturesService {
  if (!service) throw new Error('CapturesService not initialized');
  return service;
}

export function initCapturesService(db: Database.Database): CapturesService {
  if (!service || service.db !== db) service = new CapturesService(db);
  return service;
}

export { captureFromRow };
