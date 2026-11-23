import type Database from 'better-sqlite3';
import {
  BUCKETS,
  CAPTURE_STATUSES,
  captureFromRow,
  deleteCaptureFts,
  deleteDecision,
  deleteEdge,
  deleteOrphanTags,
  getCapture,
  getCaptureRow,
  getHeadByName,
  getHeadRow,
  getReminder,
  insertEdge,
  listCaptures,
  listHeads,
  listTags,
  setCaptureTags,
  syncCaptureFts,
  upsertDecision,
  upsertReminder,
  type Bucket,
  type Capture,
  type CaptureFilters,
  type CapturePage,
  type CaptureStatus,
  type DecisionSource,
  type EdgeRelation,
  type HeadRow,
} from '../db/queries.js';
import { canSpendJev, evaluateHeads, getJevMode } from '../engine/jev.js';
import { buildJevState } from '../engine/pipeline.js';
import { fetchReadable } from '../engine/deterministic.js';
import { emit } from './events.service.js';

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 429 = 400,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface DecisionPatch {
  valueText?: string | null;
  valueNum?: number | null;
}

export interface UpdateCaptureInput {
  content?: string;
  bucket?: Bucket;
  status?: CaptureStatus;
  isPinned?: boolean;
  captureMode?: 'auto' | 'manual';
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
  } | null;
  decisions?: Record<string, DecisionPatch | null>;
}

export type BulkAction =
  | { type: 'bucket'; value: Bucket }
  | { type: 'status'; value: CaptureStatus }
  | { type: 'isPinned'; value: boolean }
  | { type: 'addTags'; value: string[] }
  | { type: 'removeTags'; value: string[] }
  | { type: 'delete' }
  | { type: 'runJev' };

function resolveHead(db: Database.Database, key: string): HeadRow | undefined {
  return getHeadRow(db, key) ?? getHeadByName(db, key);
}

function writeHumanDecision(
  db: Database.Database,
  captureId: string,
  head: HeadRow,
  valueText: string | null,
  valueNum: number | null,
): void {
  const probs: Record<string, number> = valueText
    ? { [valueText]: 1 }
    : valueNum !== null
      ? { [String(valueNum)]: 1 }
      : {};
  upsertDecision(db, {
    captureId,
    headId: head.id,
    valueText,
    valueNum,
    probs,
    confidence: 1,
    entropy: 0,
    source: 'human',
  });
}

export class CapturesService {
  constructor(private readonly db: Database.Database) {}

  list(filters: CaptureFilters = {}): CapturePage {
    return listCaptures(this.db, filters);
  }

  get(id: string): Capture | undefined {
    return getCapture(this.db, id);
  }

  tags(status: CaptureStatus = 'active'): Array<{ name: string; count: number }> {
    return listTags(this.db, status);
  }

  update(id: string, patch: UpdateCaptureInput): Capture | undefined {
    const current = getCaptureRow(this.db, id);
    if (!current) return undefined;

    if (patch.content !== undefined && !patch.content.trim()) throw new ServiceError('content must be non-empty');
    if (patch.bucket !== undefined && !BUCKETS.includes(patch.bucket)) throw new ServiceError('invalid bucket');
    if (patch.status !== undefined && !CAPTURE_STATUSES.includes(patch.status)) throw new ServiceError('invalid status');

    const run = this.db.transaction(() => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown) => {
        sets.push(`${column} = ?`);
        params.push(value);
      };
      if (patch.content !== undefined) set('content', patch.content);
      if (patch.bucket !== undefined) set('bucket', patch.bucket);
      if (patch.status !== undefined) set('status', patch.status);
      if (patch.isPinned !== undefined) set('is_pinned', patch.isPinned ? 1 : 0);
      if (patch.captureMode !== undefined) set('capture_mode', patch.captureMode);
      if (patch.sourceUrl !== undefined) set('source_url', patch.sourceUrl);
      if (patch.urlTitle !== undefined) set('url_title', patch.urlTitle);
      if (patch.urlExcerpt !== undefined) set('url_excerpt', patch.urlExcerpt);
      if (patch.meta !== undefined) set('meta', JSON.stringify(patch.meta));
      if (patch.createdAt !== undefined) set('created_at', patch.createdAt);
      if (sets.length > 0) {
        set('updated_at', Date.now());
        this.db.prepare(`UPDATE captures SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      }

      if (patch.tags !== undefined) {
        setCaptureTags(this.db, id, patch.tags);
        deleteOrphanTags(this.db);
      }

      if (patch.reminder !== undefined) {
        if (patch.reminder === null) {
          this.db.prepare('DELETE FROM reminders WHERE capture_id = ?').run(id);
        } else {
          const existing = getReminder(this.db, id);
          upsertReminder(this.db, id, {
            dueAt: patch.reminder.dueAt,
            state: patch.reminder.state ?? existing?.state ?? 'pending',
            snoozeCount: patch.reminder.snoozeCount ?? existing?.snoozeCount ?? 0,
            lastNotifiedAt: existing?.lastNotifiedAt ?? null,
          });
        }
      }

      if (patch.bucket !== undefined) {
        const head = getHeadByName(this.db, 'bucket');
        if (head) writeHumanDecision(this.db, id, head, patch.bucket, null);
      }

      for (const [key, value] of Object.entries(patch.decisions ?? {})) {
        const head = resolveHead(this.db, key);
        if (!head) throw new ServiceError(`Unknown decision head: ${key}`, 404);
        if (value === null || value === undefined) {
          deleteDecision(this.db, id, head.id);
          continue;
        }
        const valueText = value.valueText ?? null;
        const valueNum = value.valueNum ?? null;
        writeHumanDecision(this.db, id, head, valueText, valueNum);
        if (head.name === 'bucket' && valueText && BUCKETS.includes(valueText as Bucket)) {
          this.db.prepare('UPDATE captures SET bucket = ?, updated_at = ? WHERE id = ?').run(valueText, Date.now(), id);
        }
      }

      syncCaptureFts(this.db, id);
    });
    run();

    const updated = getCapture(this.db, id);
    emit('capture.updated', updated);
    return updated;
  }

  remove(id: string): boolean {
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

  override(captureId: string, headId: string, valueText?: string, valueNum?: number): Capture | undefined {
    const capture = getCapture(this.db, captureId);
    if (!capture) return undefined;
    const head = resolveHead(this.db, headId);
    if (!head) throw new ServiceError('Decision head not found', 404);
    if (head.primitive === 'choice' && !valueText) throw new ServiceError('valueText is required for choice heads');
    if (head.primitive !== 'choice' && valueNum === undefined) throw new ServiceError('valueNum is required for score/noul heads');

    const run = this.db.transaction(() => {
      writeHumanDecision(this.db, captureId, head, valueText ?? null, valueNum ?? null);
      if (head.name === 'bucket' && valueText && BUCKETS.includes(valueText as Bucket)) {
        this.db.prepare('UPDATE captures SET bucket = ?, updated_at = ? WHERE id = ?').run(valueText, Date.now(), captureId);
      }
      syncCaptureFts(this.db, captureId);
    });
    run();

    const updated = getCapture(this.db, captureId);
    emit('capture.updated', updated);
    return updated;
  }

  clearDecision(captureId: string, headId: string): Capture | undefined {
    if (!getCaptureRow(this.db, captureId)) return undefined;
    const head = resolveHead(this.db, headId);
    if (!head) throw new ServiceError('Decision head not found', 404);
    deleteDecision(this.db, captureId, head.id);
    syncCaptureFts(this.db, captureId);
    const updated = getCapture(this.db, captureId);
    emit('capture.updated', updated);
    return updated;
  }

  async reevaluateWithJev(id: string, headIds?: string[]): Promise<{ capture: Capture; modelVersion: string | null; latencyMs: number } | undefined> {
    if (!getCaptureRow(this.db, id)) return undefined;
    if (getJevMode(this.db) === 'off' || !canSpendJev(this.db).ok) {
      throw new ServiceError('Jev is off or budget capped', 429);
    }
    const heads = headIds
      ? headIds.flatMap((key) => {
          const head = resolveHead(this.db, key);
          return head ? [head] : [];
        })
      : listHeads(this.db, true)
          .map((head) => getHeadRow(this.db, head.id))
          .filter((head): head is HeadRow => head !== undefined);
    if (heads.length === 0) throw new ServiceError('No active decision heads selected', 400);
    const result = await evaluateHeads(this.db, buildJevState(this.db, id), heads, 'manual');
    if (!result) throw new ServiceError('Jev request failed or budget capped', 429);

    const bucketHead = heads.find((head) => head.name === 'bucket');
    const bucketPrediction = result.predictions.find((prediction) => prediction.headId === bucketHead?.id);
    const run = this.db.transaction(() => {
      for (const prediction of result.predictions) {
        const head = heads.find((row) => row.id === prediction.headId);
        if (!head) continue;
        upsertDecision(this.db, {
          captureId: id,
          headId: head.id,
          valueText: prediction.valueText,
          valueNum: prediction.valueNum,
          probs: prediction.probs,
          confidence: prediction.confidence,
          entropy: prediction.entropy,
          source: 'jev' as DecisionSource,
          modelVersion: prediction.modelVersion,
          latencyMs: result.latencyMs,
        });
      }
      if (bucketPrediction?.valueText && BUCKETS.includes(bucketPrediction.valueText as Bucket)) {
        this.db.prepare('UPDATE captures SET bucket = ?, updated_at = ? WHERE id = ?').run(
          bucketPrediction.valueText,
          Date.now(),
          id,
        );
      }
      syncCaptureFts(this.db, id);
    });
    run();

    const capture = getCapture(this.db, id);
    if (!capture) return undefined;
    emit('capture.updated', capture);
    return { capture, modelVersion: result.modelVersion, latencyMs: result.latencyMs };
  }

  addEdge(sourceId: string, targetId: string, relation: EdgeRelation, note?: string | null): void {
    if (sourceId === targetId) throw new ServiceError('A capture cannot link to itself');
    if (!getCaptureRow(this.db, sourceId) || !getCaptureRow(this.db, targetId)) {
      throw new ServiceError('Capture not found', 404);
    }
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
    this.db
      .prepare('UPDATE captures SET source_url = ?, url_title = ?, url_excerpt = ?, updated_at = ? WHERE id = ?')
      .run(readable.url, readable.title, readable.excerpt, Date.now(), id);
    syncCaptureFts(this.db, id);
    const updated = getCapture(this.db, id);
    emit('capture.updated', updated);
    return updated;
  }

  async bulkAction(ids: string[], action: BulkAction): Promise<{ affected: number }> {
    const existing = ids.filter((id) => getCaptureRow(this.db, id) !== undefined);
    if (action.type === 'delete') {
      for (const id of existing) this.remove(id);
      return { affected: existing.length };
    }
    if (action.type === 'runJev') {
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < existing.length) {
          const id = existing[cursor];
          cursor += 1;
          if (!id) continue;
          try {
            await this.reevaluateWithJev(id);
          } catch {
            // Budget and transport failures are reported by the individual Jev call.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, existing.length) }, () => worker()));
      return { affected: existing.length };
    }

    for (const id of existing) {
      const capture = getCapture(this.db, id);
      if (!capture) continue;
      if (action.type === 'bucket') this.update(id, { bucket: action.value });
      else if (action.type === 'status') this.update(id, { status: action.value });
      else if (action.type === 'isPinned') this.update(id, { isPinned: action.value });
      else if (action.type === 'addTags') {
        this.update(id, { tags: [...new Set([...capture.tags, ...action.value])] });
      } else if (action.type === 'removeTags') {
        const removed = new Set(action.value);
        this.update(id, { tags: capture.tags.filter((tag) => !removed.has(tag)) });
      }
    }
    return { affected: existing.length };
  }
}

let service: CapturesService | undefined;

export function getCapturesService(): CapturesService {
  if (!service) throw new Error('CapturesService not initialized');
  return service;
}

export function initCapturesService(db: Database.Database): CapturesService {
  if (!service) service = new CapturesService(db);
  return service;
}

export { captureFromRow };
