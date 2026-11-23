import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  BUCKETS,
  captureFromRow,
  getCapture,
  getCaptureRow,
  getHeadRow,
  getSetting,
  insertDecision,
  insertEdge,
  listHeads,
  setCaptureTags,
  setSetting,
  type Bucket,
  type CaptureRow,
  type HeadRow,
} from '../db/queries.js';
import { runDeterministic } from './deterministic.js';
import { embed, vectorIndex, vectorToBlob } from './embeddings.js';
import { buildFeatureVector, predictHead, recordAgreement, trainStep, type Prediction } from './localProbe.js';
import { evaluateHeads, evaluatePairRelation, getJevMode } from './jev.js';
import { decayLambdaForHalfLife } from './physics.js';
import { emit } from '../services/events.service.js';

const DEFAULT_REMINDER_DELAY_MS = 4 * 3_600_000;

export interface IngestInput {
  content: string;
  tgMessageId?: number;
  tgChatId?: number;
  replyToTgMessageId?: number;
  forceJev?: boolean;
}

export interface CollisionPayload {
  candidateId: string;
  candidateContent: string;
  relation: 'contradicts' | 'reinforces' | 'refines';
  confidence: number;
}

export type IngestResult =
  | { kind: 'resonance'; targetId: string; targetContent: string; count: number; firstSeenAt: number }
  | {
      kind: 'capture';
      captureReturn: ReturnType<typeof getCapture>;
      bucketPrediction: Prediction | null;
      collision: CollisionPayload | null;
      reminderDueAt: number | null;
      jevUsed: boolean;
    };

function updatedCapture(db: Database.Database, id: string) {
  const row = getCaptureRow(db, id);
  if (!row) return undefined;
  return getCapture(db, id);
}

export async function ingestCapture(db: Database.Database, input: IngestInput): Promise<IngestResult> {
  const content = input.content.trim();
  const now = Date.now();
  const deterministic = await runDeterministic(content, new Date(now));
  const embedding = await embed(deterministic.text);
  const neighbors = vectorIndex.search(embedding, 5);

  const resonanceMin = Number(getSetting(db, 'resonance_min_cos', '0.91'));
  const collisionMin = Number(getSetting(db, 'collision_min_cos', '0.68'));
  const mode = getJevMode(db);
  const isReply = input.replyToTgMessageId !== undefined;

  const neighborRows = neighbors
    .map((neighbor) => ({ ...neighbor, row: getCaptureRow(db, neighbor.id) }))
    .filter((item): item is { id: string; score: number; row: CaptureRow } => item.row !== undefined && item.row.status === 'active');

  // Resonance: near-duplicate merge without spending a Jev call.
  const top = neighborRows[0];
  if (!isReply && top && top.score >= resonanceMin) {
    const meta = JSON.parse(top.row.meta) as Record<string, unknown>;
    const resonances = Array.isArray(meta.resonances) ? meta.resonances : [];
    resonances.push({ at: now, text: deterministic.text });
    const nextMeta = JSON.stringify({ ...meta, resonances: resonances.slice(-20) });
    const firstSeenAt = top.row.created_at;
    db.prepare(
      `UPDATE captures SET resonance_count = resonance_count + 1,
         energy = MIN(2.0, energy + 0.5), last_activated_at = ?, meta = ?, updated_at = ? WHERE id = ?`,
    ).run(now, nextMeta, now, top.row.id);
    emit('capture.updated', updatedCapture(db, top.row.id));
    return {
      kind: 'resonance',
      targetId: top.row.id,
      targetContent: top.row.content,
      count: top.row.resonance_count + 1,
      firstSeenAt,
    };
  }

  const id = nanoid();
  const simhash = deterministic.simhash;
  db.prepare(
    `INSERT INTO captures
      (id, content, bucket, status, is_pinned, energy, decay_lambda, resonance_count,
       last_activated_at, simhash, embedding, meta, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 0, 1.0, 0.05, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    deterministic.text || content,
    deterministic.bucketHint ?? 'idea',
    now,
    simhash,
    vectorToBlob(embedding),
    JSON.stringify(deterministic.meta),
    now,
    now,
  );
  setCaptureTags(db, id, deterministic.tags);
  vectorIndex.upsert(id, embedding);

  let tgMessageId: number | null = null;
  if (input.tgMessageId !== undefined && input.tgChatId !== undefined) {
    db.prepare(
      `INSERT OR REPLACE INTO telegram_messages (tg_message_id, tg_chat_id, capture_id, role, created_at)
       VALUES (?, ?, ?, 'input', ?)`,
    ).run(input.tgMessageId, input.tgChatId, id, now);
    tgMessageId = input.tgMessageId;
  }

  // Reply edge (and optional Jev refinement).
  if (isReply) {
    const parent = db
      .prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?')
      .get(input.replyToTgMessageId!) as { capture_id: string } | undefined;
    if (parent) {
      insertEdge(db, id, parent.capture_id, 'reply', 1, {});
      emit('edge.created', { sourceId: id, targetId: parent.capture_id, relation: 'reply' });
      if (mode !== 'off') {
        const parentRow = getCaptureRow(db, parent.capture_id);
        if (parentRow) {
          const relation = await evaluatePairRelation(db, deterministic.text, parentRow.content, 'reply');
          if (relation && relation.relation !== 'unrelated') {
            insertEdge(db, id, parent.capture_id, relation.relation, relation.confidence, { via: 'jev' });
            emit('edge.created', { sourceId: id, targetId: parent.capture_id, relation: relation.relation });
          }
        }
      }
    }
  }

  const headRows = listHeads(db, true).map((head) => getHeadRow(db, head.id)).filter((row): row is HeadRow => row !== undefined);
  const x = buildFeatureVector(embedding, deterministic.features);
  const local = new Map<string, Prediction>();
  for (const head of headRows) {
    const prediction = predictHead(db, head, x);
    local.set(head.id, prediction);
    insertDecision(db, {
      captureId: id,
      headId: head.id,
      valueText: prediction.valueText,
      valueNum: prediction.valueNum,
      probs: prediction.probs,
      confidence: prediction.confidence,
      entropy: prediction.entropy,
      source: prediction.isCold ? 'local_knn' : 'local_probe',
      latencyMs: 0,
    });
  }

  let jevUsed = false;
  const shouldEscalate =
    mode === 'bootstrap' ||
    input.forceJev === true ||
    (mode === 'gated' &&
      headRows.some((head) => {
        const prediction = local.get(head.id)!;
        return (
          head.auto_escalate === 1 &&
          (prediction.isCold || prediction.confidence < head.local_threshold || prediction.entropy > 0.55)
        );
      }));

  if (shouldEscalate && mode !== 'off') {
    const result = await evaluateHeads(db, deterministic.text, headRows, input.forceJev ? 'manual' : 'entropy');
    if (result) {
      jevUsed = true;
      for (const prediction of result.predictions) {
        const head = headRows.find((row) => row.id === prediction.headId);
        if (!head) continue;
        const localPrediction = local.get(head.id);
        insertDecision(db, {
          captureId: id,
          headId: head.id,
          valueText: prediction.valueText,
          valueNum: prediction.valueNum,
          probs: prediction.probs,
          confidence: prediction.confidence,
          entropy: prediction.entropy,
          source: 'jev',
          latencyMs: result.latencyMs,
        });
        if (localPrediction) {
          const agreed =
            head.primitive === 'choice'
              ? localPrediction.valueText === prediction.valueText
              : Math.abs((localPrediction.valueNum ?? 0) - (prediction.valueNum ?? 0)) < 0.5;
          recordAgreement(db, head.id, agreed);
        }
        trainStep(db, head, x, { valueText: prediction.valueText, valueNum: prediction.valueNum }, 1);
        local.set(head.id, { ...prediction, isCold: false });
      }

      if (mode === 'bootstrap') {
        const bucketHead = headRows.find((head) => head.name === 'bucket');
        const target = Number(getSetting(db, 'bootstrap_target', '40'));
        if (bucketHead) {
          const refreshed = getHeadRow(db, bucketHead.id);
          if (refreshed && refreshed.sample_count >= target) {
            setSetting(db, 'jev_mode', 'gated');
            emit('telemetry.updated', { jevMode: 'gated', reason: 'bootstrap target reached' });
          }
        }
      }
    }
  }

  // Apply bucket + half-life.
  const bucketHead = headRows.find((head) => head.name === 'bucket');
  const bucketPrediction = bucketHead ? local.get(bucketHead.id) ?? null : null;
  let bucket: Bucket = deterministic.bucketHint ?? 'idea';
  if (!deterministic.bucketHint && bucketPrediction?.valueText && BUCKETS.includes(bucketPrediction.valueText as Bucket)) {
    bucket = bucketPrediction.valueText as Bucket;
  }

  const halfLifeHead = headRows.find((head) => head.name === 'half_life');
  const halfLifePrediction = halfLifeHead ? local.get(halfLifeHead.id) : undefined;
  let decayLambda = halfLifePrediction ? decayLambdaForHalfLife(halfLifePrediction.valueNum ?? 1) : 0.05;
  if (bucket === 'memory') decayLambda = 0;

  db.prepare('UPDATE captures SET bucket = ?, decay_lambda = ?, updated_at = ? WHERE id = ?').run(
    bucket,
    decayLambda,
    Date.now(),
    id,
  );

  // Reminder creation.
  let reminderDueAt: number | null = deterministic.parsedDueAt;
  if (!reminderDueAt && bucket === 'reminder') reminderDueAt = Date.now() + DEFAULT_REMINDER_DELAY_MS;
  if (reminderDueAt) {
    db.prepare(
      `INSERT INTO reminders (capture_id, due_at, state) VALUES (?, ?, 'pending')
       ON CONFLICT(capture_id) DO UPDATE SET due_at = excluded.due_at, state = 'pending'`,
    ).run(id, reminderDueAt);
  }

  // Collision zone.
  let collision: CollisionPayload | null = null;
  if (mode !== 'off' && (bucket === 'idea' || bucket === 'question')) {
    const candidate = neighborRows.find((item) => item.id !== id && item.score >= collisionMin && item.score < resonanceMin);
    if (candidate) {
      const relation = await evaluatePairRelation(db, deterministic.text, candidate.row.content, 'collision');
      if (relation && relation.relation === 'contradicts' && relation.confidence >= 0.78) {
        insertEdge(db, id, candidate.row.id, 'contradicts', relation.confidence, { via: 'jev' });
        insertEdge(db, id, candidate.row.id, 'paradox', relation.confidence, { via: 'jev' });
        collision = {
          candidateId: candidate.row.id,
          candidateContent: candidate.row.content,
          relation: 'contradicts',
          confidence: relation.confidence,
        };
      } else if (relation && (relation.relation === 'reinforces' || relation.relation === 'refines') && relation.confidence >= 0.75) {
        insertEdge(db, id, candidate.row.id, relation.relation, relation.confidence, { via: 'jev' });
        db.prepare('UPDATE captures SET energy = MIN(2.0, energy + 0.2), last_activated_at = ? WHERE id IN (?, ?)').run(
          Date.now(),
          id,
          candidate.row.id,
        );
      }
      if (relation && relation.relation !== 'unrelated') {
        emit('edge.created', { sourceId: id, targetId: candidate.row.id, relation: relation.relation });
      }
    }
  }

  const created = updatedCapture(db, id);
  emit('capture.created', created);
  if (tgMessageId !== null) emit('telemetry.updated', { captureId: id });

  return {
    kind: 'capture',
    captureReturn: created,
    bucketPrediction,
    collision,
    reminderDueAt,
    jevUsed,
  };
}

export { captureFromRow };
