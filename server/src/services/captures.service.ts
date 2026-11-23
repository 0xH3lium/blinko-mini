import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  BUCKETS,
  buildFtsQuery,
  captureFromRow,
  deleteOrphanTags,
  getCapture,
  getCaptureRow,
  getDecisionsForCapture,
  getHeadRow,
  insertDecision,
  latestDecisionsFor,
  listCaptures,
  listTags,
  setCaptureTags,
  type Bucket,
  type Capture,
  type CaptureFilters,
  type CapturePage,
  type CaptureStatus,
} from '../db/queries.js';
import { buildFeatureVector, predictHead, recordAgreement, trainStep } from '../engine/localProbe.js';
import { embed, fallbackEmbedding, vectorIndex, vectorToBlob } from '../engine/embeddings.js';
import { lexicalFeatures, simhash, extractHashtags, parseDueAt } from '../engine/deterministic.js';
import { emit } from './events.service.js';
import { decayLambdaForHalfLife } from '../engine/physics.js';

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface UpdateCaptureInput {
  content?: string;
  bucket?: Bucket;
  status?: CaptureStatus;
  isPinned?: boolean;
  tags?: string[];
  reminderDueAt?: number | null;
}

function normalizeTags(tags: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, '').toLowerCase();
    if (/^[a-z0-9_-]{1,50}$/.test(tag)) out.add(tag);
  }
  return [...out];
}

export class CapturesService {
  constructor(private readonly db: Database.Database) {}

  list(filters: CaptureFilters = {}): CapturePage {
    const semantic = filters.q && !filters.semantic
      ? vectorIndex.search(fallbackEmbedding(filters.q), 200).map((item) => ({ id: item.id, score: item.score }))
      : undefined;
    return listCaptures(this.db, { ...filters, ...(semantic ? { semantic } : {}) });
  }

  get(id: string): (Capture & { decisions: ReturnType<typeof getDecisionsForCapture> }) | undefined {
    const capture = getCapture(this.db, id);
    if (!capture) return undefined;
    return { ...capture, decisions: getDecisionsForCapture(this.db, id) };
  }

  tags(status: CaptureStatus = 'active'): Array<{ name: string; count: number }> {
    return listTags(this.db, status);
  }

  update(id: string, input: UpdateCaptureInput): Capture | undefined {
    const row = getCaptureRow(this.db, id);
    if (!row) return undefined;
    const now = Date.now();

    const content = input.content === undefined ? row.content : input.content.trim();
    if (!content) throw new ServiceError('content must be a non-empty string');
    if (input.bucket !== undefined && !BUCKETS.includes(input.bucket)) throw new ServiceError('invalid bucket');
    if (input.status !== undefined && !['active', 'resolved', 'sublimated'].includes(input.status)) {
      throw new ServiceError('invalid status');
    }

    let embedding: Buffer | null = row.embedding;
    let newEmbedding: Float32Array | null = null;
    if (input.content !== undefined && content !== row.content) {
      newEmbedding = fallbackEmbedding(content);
      embedding = vectorToBlob(newEmbedding);
    }

    const tags =
      input.tags !== undefined
        ? normalizeTags([...extractHashtags(content), ...input.tags])
        : normalizeTags(extractHashtags(content).length > 0
            ? [...(getCapture(this.db, id)?.tags ?? []), ...extractHashtags(content)]
            : (getCapture(this.db, id)?.tags ?? []));

    const bucket = input.bucket ?? row.bucket;
    const status = input.status ?? row.status;
    const isPinned = input.isPinned === undefined ? row.is_pinned : input.isPinned ? 1 : 0;

    let decayLambda = row.decay_lambda;
    if (isPinned === 1 || bucket === 'memory') decayLambda = 0;
    else if (input.bucket !== undefined && row.decay_lambda === 0) decayLambda = 0.05;

    this.db
      .prepare(
        `UPDATE captures SET content = ?, bucket = ?, status = ?, is_pinned = ?, decay_lambda = ?,
           embedding = ?, simhash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        content,
        bucket,
        status,
        isPinned,
        decayLambda,
        embedding,
        input.content !== undefined ? simhash(content) : row.simhash,
        now,
        id,
      );
    setCaptureTags(this.db, id, tags);
    deleteOrphanTags(this.db);

    if (newEmbedding) vectorIndex.upsert(id, newEmbedding);

    if (input.reminderDueAt !== undefined) {
      if (input.reminderDueAt === null) {
        this.db.prepare('DELETE FROM reminders WHERE capture_id = ?').run(id);
      } else {
        this.db
          .prepare(
            `INSERT INTO reminders (capture_id, due_at, state) VALUES (?, ?, 'pending')
             ON CONFLICT(capture_id) DO UPDATE SET due_at = excluded.due_at, state = 'pending'`,
          )
          .run(id, input.reminderDueAt);
        emit('reminder.updated', { captureId: id, dueAt: input.reminderDueAt });
      }
    }

    if (input.bucket !== undefined && input.bucket !== row.bucket) {
      this.trainBucketOverride(id, content, input.bucket);
    }

    if (input.content !== undefined && input.content !== row.content) {
      const due = parseDueAt(content);
      if (due) {
        this.db
          .prepare(
            `INSERT INTO reminders (capture_id, due_at, state) VALUES (?, ?, 'pending')
             ON CONFLICT(capture_id) DO UPDATE SET due_at = excluded.due_at, state = 'pending'`,
          )
          .run(id, due);
      }
    }

    const updated = getCapture(this.db, id);
    emit('capture.updated', updated);
    return updated;
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM captures WHERE id = ?').run(id);
    if (result.changes > 0) {
      vectorIndex.remove(id);
      deleteOrphanTags(this.db);
      emit('capture.deleted', { id });
      return true;
    }
    return false;
  }

  override(captureId: string, headId: string, valueText?: string, valueNum?: number): Capture | undefined {
    const capture = getCapture(this.db, captureId);
    if (!capture) return undefined;
    const head = getHeadRow(this.db, headId);
    if (!head) throw new ServiceError('Decision head not found', 404);
    const row = getCaptureRow(this.db, captureId)!;

    const prior = getDecisionsForCapture(this.db, captureId).find((decision) => decision.headId === headId);
    const target = valueText ?? (valueNum !== undefined ? String(valueNum) : null);
    if (head.primitive === 'choice' && !valueText) throw new ServiceError('valueText is required for choice heads');
    if (head.primitive !== 'choice' && valueNum === undefined) throw new ServiceError('valueNum is required for score/noul heads');

    const probs: Record<string, number> = valueText ? { [valueText]: 1 } : { [String(valueNum)]: 1 };
    insertDecision(this.db, {
      captureId,
      headId,
      valueText: valueText ?? null,
      valueNum: valueNum ?? null,
      probs,
      confidence: 1,
      entropy: 0,
      source: 'human',
      latencyMs: 0,
    });

    const embedding = row.embedding
      ? new Float32Array(Buffer.from(row.embedding).buffer, 0, 384)
      : fallbackEmbedding(capture.content);
    const x = buildFeatureVector(embedding, lexicalFeatures(capture.content, null));
    if (prior) recordAgreement(this.db, headId, prior.valueText === valueText && (valueNum === undefined || Math.abs((prior.valueNum ?? 0) - valueNum) < 0.5));
    trainStep(this.db, head, x, { valueText: valueText ?? null, valueNum: valueNum ?? null }, 2.5);

    if (head.name === 'bucket' && valueText && BUCKETS.includes(valueText as Bucket)) {
      this.db.prepare('UPDATE captures SET bucket = ?, updated_at = ? WHERE id = ?').run(valueText, Date.now(), captureId);
    }
    if (head.name === 'half_life' && valueNum !== undefined) {
      const lambda = decayLambdaForHalfLife(valueNum);
      this.db.prepare('UPDATE captures SET decay_lambda = ?, updated_at = ? WHERE id = ?').run(lambda, Date.now(), captureId);
    }

    const updated = getCapture(this.db, captureId);
    emit('capture.updated', updated);
    return updated;
  }

  private trainBucketOverride(captureId: string, content: string, bucket: Bucket): void {
    const head = this.db.prepare('SELECT * FROM decision_heads WHERE name = ?').get('bucket') as
      | Parameters<typeof predictHead>[1]
      | undefined;
    if (!head) return;
    const row = getCaptureRow(this.db, captureId);
    const embedding = row?.embedding
      ? new Float32Array(Buffer.from(row.embedding).buffer, 0, 384)
      : fallbackEmbedding(content);
    const x = buildFeatureVector(embedding, lexicalFeatures(content, null));
    insertDecision(this.db, {
      captureId,
      headId: head.id,
      valueText: bucket,
      valueNum: 1,
      probs: { [bucket]: 1 },
      confidence: 1,
      entropy: 0,
      source: 'human',
      latencyMs: 0,
    });
    trainStep(this.db, head, x, { valueText: bucket }, 2.5);
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

export { buildFtsQuery, captureFromRow, latestDecisionsFor };
