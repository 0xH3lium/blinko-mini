import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  BUCKETS,
  getCapture,
  getCaptureRow,
  getHeadByName,
  getHeadRow,
  getReminder,
  insertEdge,
  listHeads,
  setCaptureTags,
  syncCaptureFts,
  upsertDecision,
  upsertReminder,
  type Bucket,
  type Capture,
  type CaptureStatus,
  type Decision,
  type EdgeRelation,
  type HeadRow,
} from '../db/queries.js';
import { runDeterministic, fetchReadable } from './deterministic.js';
import { evaluateHeads, getJevMode, canSpendJev, type JevState } from './jev.js';
import { emit } from '../services/events.service.js';

const DEFAULT_REMINDER_DELAY_MS = 4 * 3_600_000;

export interface ManualDecisionInput {
  valueText?: string | null;
  valueNum?: number | null;
}

export interface ManualLinkInput {
  targetId: string;
  relation: EdgeRelation;
  note?: string | null;
}

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
  reminderState?: 'pending' | 'notified' | 'done' | 'killed';
  snoozeCount?: number;
  decisions?: Record<string, ManualDecisionInput | null>;
  links?: ManualLinkInput[];
  fetchUrl?: boolean;
}

export interface IngestCaptureAutoInput {
  content: string;
  tgMessageId?: number;
  tgChatId?: number;
  replyToTgMessageId?: number;
  skipUrlFetch?: boolean;
  forceJev?: boolean;
}

export interface PipelineResult {
  capture: Capture | undefined;
  bucketDecision: Decision | null;
  reminderDueAt: number | null;
  jevUsed: boolean;
}

function resolveHead(db: Database.Database, key: string): HeadRow | undefined {
  return getHeadRow(db, key) ?? getHeadByName(db, key);
}

function humanDecision(
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

function syncBucketHead(db: Database.Database, captureId: string, bucket: Bucket, source: 'human' | 'deterministic'): void {
  const head = getHeadByName(db, 'bucket');
  if (!head) return;
  upsertDecision(db, {
    captureId,
    headId: head.id,
    valueText: bucket,
    valueNum: null,
    probs: { [bucket]: 1 },
    confidence: 1,
    entropy: 0,
    source,
  });
}

function bucketDecisionOf(capture: Capture | undefined, headId: string | undefined): Decision | null {
  if (!capture || !headId) return null;
  return Object.values(capture.decisions).find((decision) => decision.headId === headId) ?? null;
}

export function buildJevState(db: Database.Database, captureId: string): JevState {
  const capture = getCapture(db, captureId);
  const state: JevState = { content: capture?.content ?? '', tags: capture?.tags ?? [] };
  if (capture?.sourceUrl) {
    state.url = {
      url: capture.sourceUrl,
      title: capture.urlTitle ?? '',
      excerpt: capture.urlExcerpt ?? '',
    };
  }
  const parentRow = db
    .prepare("SELECT source_id FROM capture_edges WHERE target_id = ? AND relation = 'reply' LIMIT 1")
    .get(captureId) as { source_id: string } | undefined;
  if (parentRow) {
    const parent = getCaptureRow(db, parentRow.source_id);
    if (parent) state.parentCapture = { bucket: parent.bucket, content: parent.content };
  }
  return state;
}

export async function createCaptureManual(db: Database.Database, input: CreateCaptureManualInput): Promise<PipelineResult> {
  const id = nanoid();
  const now = Date.now();
  let sourceUrl = input.sourceUrl ?? null;
  let urlTitle = input.urlTitle ?? null;
  let urlExcerpt = input.urlExcerpt ?? null;
  if (input.fetchUrl === true && sourceUrl && (!urlTitle || !urlExcerpt)) {
    const readable = await fetchReadable(sourceUrl);
    if (readable) {
      sourceUrl = readable.url;
      urlTitle = urlTitle || readable.title || null;
      urlExcerpt = urlExcerpt || readable.excerpt || null;
    }
  }

  const createdAt = input.createdAt ?? now;
  db.prepare(
    `INSERT INTO captures
       (id, content, bucket, status, is_pinned, capture_mode, source_url, url_title, url_excerpt,
        meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.content,
    input.bucket,
    input.status,
    input.isPinned ? 1 : 0,
    sourceUrl,
    urlTitle,
    urlExcerpt,
    JSON.stringify(input.meta ?? {}),
    createdAt,
    now,
  );

  const run = db.transaction(() => {
    setCaptureTags(db, id, input.tags ?? []);
    for (const [key, value] of Object.entries(input.decisions ?? {})) {
      const head = resolveHead(db, key);
      if (!head || value === null || value === undefined) continue;
      humanDecision(
        db,
        id,
        head,
        value.valueText ?? null,
        value.valueNum ?? null,
      );
    }
    syncBucketHead(db, id, input.bucket, 'human');
    for (const link of input.links ?? []) {
      if (link.targetId === id) continue;
      const target = getCaptureRow(db, link.targetId);
      if (!target) continue;
      insertEdge(db, id, link.targetId, link.relation, link.note ?? null);
    }
    if (input.reminderDueAt !== undefined && input.reminderDueAt !== null) {
      upsertReminder(db, id, {
        dueAt: input.reminderDueAt,
        state: input.reminderState ?? 'pending',
        snoozeCount: input.snoozeCount ?? 0,
      });
    }
    syncCaptureFts(db, id);
  });
  run();

  const capture = getCapture(db, id);
  const head = getHeadByName(db, 'bucket');
  emit('capture.created', capture);
  return {
    capture,
    bucketDecision: bucketDecisionOf(capture, head?.id),
    reminderDueAt: getReminder(db, id)?.dueAt ?? null,
    jevUsed: false,
  };
}

export async function ingestCaptureAuto(db: Database.Database, input: IngestCaptureAutoInput): Promise<PipelineResult> {
  const deterministic = await runDeterministic(input.content, new Date(), input.skipUrlFetch === true);

  if (deterministic.manualBypass) {
    return createCaptureManual(db, {
      content: deterministic.text,
      bucket: deterministic.bucketHint ?? 'idea',
      status: 'active',
      isPinned: false,
      tags: deterministic.tags,
      sourceUrl: deterministic.sourceUrl,
      urlTitle: deterministic.urlTitle,
      urlExcerpt: deterministic.urlExcerpt,
      meta: deterministic.meta,
      reminderDueAt: deterministic.parsedDueAt,
    });
  }

  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO captures
       (id, content, bucket, status, is_pinned, capture_mode, source_url, url_title, url_excerpt,
        meta, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 0, 'auto', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    deterministic.text,
    deterministic.bucketHint ?? 'idea',
    deterministic.sourceUrl,
    deterministic.urlTitle,
    deterministic.urlExcerpt,
    JSON.stringify(deterministic.meta),
    now,
    now,
  );

  setCaptureTags(db, id, deterministic.tags);
  if (input.tgMessageId !== undefined && input.tgChatId !== undefined) {
    db.prepare(
      `INSERT OR REPLACE INTO telegram_messages (tg_message_id, tg_chat_id, capture_id, role, created_at)
       VALUES (?, ?, ?, 'input', ?)`,
    ).run(input.tgMessageId, input.tgChatId, id, now);
  }
  if (input.replyToTgMessageId !== undefined) {
    const parent = db
      .prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?')
      .get(input.replyToTgMessageId) as { capture_id: string } | undefined;
    if (parent && parent.capture_id !== id) insertEdge(db, id, parent.capture_id, 'reply', null);
  }

  const headRows = listHeads(db, true)
    .map((head) => getHeadRow(db, head.id))
    .filter((head): head is HeadRow => head !== undefined);
  let jevUsed = false;
  let bucket = deterministic.bucketHint ?? 'idea';

  if (getJevMode(db) === 'auto' && canSpendJev(db).ok) {
    const state = buildJevState(db, id);
    const result = await evaluateHeads(db, state, headRows, input.forceJev ? 'manual' : 'auto');
    if (result) {
      jevUsed = true;
      for (const prediction of result.predictions) {
        const head = headRows.find((row) => row.id === prediction.headId);
        if (!head) continue;
        upsertDecision(db, {
          captureId: id,
          headId: head.id,
          valueText: prediction.valueText,
          valueNum: prediction.valueNum,
          probs: prediction.probs,
          confidence: prediction.confidence,
          entropy: prediction.entropy,
          source: 'jev',
          modelVersion: prediction.modelVersion,
          latencyMs: result.latencyMs,
        });
      }
      if (!deterministic.bucketHint) {
        const bucketHead = headRows.find((head) => head.name === 'bucket');
        const prediction = result.predictions.find((item) => item.headId === bucketHead?.id);
        if (prediction?.valueText && BUCKETS.includes(prediction.valueText as Bucket)) {
          bucket = prediction.valueText as Bucket;
        }
      }
    }
  }

  if (deterministic.bucketHint) syncBucketHead(db, id, deterministic.bucketHint, 'deterministic');
  db.prepare('UPDATE captures SET bucket = ?, updated_at = ? WHERE id = ?').run(bucket, Date.now(), id);

  let reminderDueAt = deterministic.parsedDueAt;
  if (!reminderDueAt && (bucket === 'reminder' || deterministic.bucketHint === 'reminder')) {
    reminderDueAt = now + DEFAULT_REMINDER_DELAY_MS;
  }
  if (reminderDueAt) upsertReminder(db, id, { dueAt: reminderDueAt });
  syncCaptureFts(db, id);

  const capture = getCapture(db, id);
  const bucketHead = getHeadByName(db, 'bucket');
  emit('capture.created', capture);
  return {
    capture,
    bucketDecision: bucketDecisionOf(capture, bucketHead?.id),
    reminderDueAt,
    jevUsed,
  };
}
