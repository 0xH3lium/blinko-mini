import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import {
  BUCKETS,
  getCapture,
  getCaptureRow,
  getHeadRow,
  getReminder,
  getSetting,
  latestDecisionsFor,
  getSettings,
  insertDecision,
  jevUsageTotals,
  listCaptures,
  listEdgesForCapture,
  listHeads,
  listReminders,
  listTags,
  localHitRate,
  setSetting,
  type Bucket,
  type CaptureFilters,
  type HeadFilter,
  type HeadRow,
} from '../db/queries.js';
import { initCapturesService, ServiceError } from '../services/captures.service.js';
import { ingestCapture } from '../engine/pipeline.js';
import { runDeterministic, lexicalFeatures } from '../engine/deterministic.js';
import { embed, vectorIndex } from '../engine/embeddings.js';
import { buildFeatureVector, predictHead, recordAgreement, trainStep } from '../engine/localProbe.js';
import { evaluateHeads, getJevMode, canSpendJev } from '../engine/jev.js';
import { effectiveEnergyFor, survivalBuckets } from '../engine/physics.js';
import { emit, subscribe } from '../services/events.service.js';
import { sessionAuth } from '../middleware/sessionAuth.js';

const db = (): Database.Database => getDatabase();
const captures = () => initCapturesService(db());

const bucketEnum = z.enum(['idea', 'memory', 'reminder', 'question', 'reference', 'noise']);
const statusEnum = z.enum(['active', 'resolved', 'sublimated']);

function fail(c: { json: (body: unknown, status: 400) => Response }, message: string): Response {
  return c.json({ error: message }, 400);
}

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ServiceError('Request body must be valid JSON');
  }
}

export const apiRoutes = new Hono();

apiRoutes.get('/health', (c) =>
  c.json({
    ok: true,
    botMode: config.BOT_MODE,
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
    jevMode: getJevMode(db()),
  }),
);

apiRoutes.use('*', sessionAuth);

apiRoutes.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    let id = 0;
    const unsubscribe = subscribe((event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event.data), id: String(++id) });
    });
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n');
    }, 25_000);
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ok: true }) });
    await new Promise<void>(() => undefined);
  }),
);

apiRoutes.get('/captures', async (c) => {
  const query = c.req.query();
  const filters: CaptureFilters = {
    status: statusEnum.safeParse(query.status).success ? (query.status as 'active') : 'active',
    limit: query.limit ? Number(query.limit) : 100,
    offset: query.offset ? Number(query.offset) : 0,
  };
  if (query.bucket && BUCKETS.includes(query.bucket as Bucket)) filters.bucket = query.bucket as Bucket;
  if (query.tag) filters.tag = query.tag;
  if (query.q) filters.q = query.q;
  if (query.paradoxOnly === 'true') filters.paradoxOnly = true;
  if (query.minResonance) filters.minResonance = Number(query.minResonance);
  if (query.minEnergy) filters.minEnergy = Number(query.minEnergy);
  if (query.maxEnergy) filters.maxEnergy = Number(query.maxEnergy);
  if (query.sort) filters.sort = query.sort as CaptureFilters['sort'];
  if (query.headFilters) {
    try {
      const parsed = z
        .array(z.object({ head: z.string(), min: z.number().optional(), max: z.number().optional() }))
        .safeParse(JSON.parse(query.headFilters));
      if (parsed.success) filters.headFilters = parsed.data as HeadFilter[];
    } catch {
      return fail(c, 'headFilters must be valid JSON');
    }
  }
  if (query.q) {
    const vec = await embed(query.q);
    filters.semantic = vectorIndex.search(vec, 200).map((item) => ({ id: item.id, score: item.score }));
  }
  return c.json(captures().list(filters));
});

apiRoutes.get('/captures/:id', (c) => {
  const id = c.req.param('id');
  const capture = getCapture(db(), id);
  if (!capture) return c.json({ error: 'Capture not found' }, 404);
  return c.json({
    ...captures().get(id),
    edges: listEdgesForCapture(db(), id),
    reminder: getReminder(db(), id) ?? null,
    effectiveEnergy: effectiveEnergyFor(db(), getCaptureRow(db(), id)!),
  });
});

apiRoutes.post('/captures', async (c) => {
  const body = (await jsonBody(c)) as { content?: unknown };
  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    return fail(c, 'content must be a non-empty string');
  }
  const result = await ingestCapture(db(), { content: body.content, forceJev: (body as { forceJev?: boolean }).forceJev });
  return c.json(result, 201);
});

apiRoutes.patch('/captures/:id', async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const content = typeof body.content === 'string' ? body.content : undefined;
  const bucket = bucketEnum.safeParse(body.bucket).success ? (body.bucket as Bucket) : undefined;
  const status = statusEnum.safeParse(body.status).success ? (body.status as 'active') : undefined;
  const isPinned = typeof body.isPinned === 'boolean' ? body.isPinned : undefined;
  const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined;
  const reminderDueAt =
    body.reminderDueAt === null ? null : typeof body.reminderDueAt === 'number' ? body.reminderDueAt : undefined;
  const updated = captures().update(c.req.param('id'), {
    ...(content !== undefined ? { content } : {}),
    ...(bucket !== undefined ? { bucket } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(isPinned !== undefined ? { isPinned } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(reminderDueAt !== undefined ? { reminderDueAt } : {}),
  });
  if (!updated) return c.json({ error: 'Capture not found' }, 404);
  return c.json(updated);
});

apiRoutes.delete('/captures/:id', (c) => {
  const id = c.req.param('id');
  if (!captures().remove(id)) return c.json({ error: 'Capture not found' }, 404);
  return c.json({ deleted: true, id });
});

apiRoutes.post('/captures/:id/override', async (c) => {
  const body = (await jsonBody(c)) as { headId?: unknown; valueText?: unknown; valueNum?: unknown };
  if (typeof body.headId !== 'string') return fail(c, 'headId is required');
  const updated = captures().override(
    c.req.param('id'),
    body.headId,
    typeof body.valueText === 'string' ? body.valueText : undefined,
    typeof body.valueNum === 'number' ? body.valueNum : undefined,
  );
  if (!updated) return c.json({ error: 'Capture not found' }, 404);
  return c.json(updated);
});

apiRoutes.post('/captures/:id/jev', async (c) => {
  const id = c.req.param('id');
  const capture = getCapture(db(), id);
  const row = getCaptureRow(db(), id);
  if (!capture || !row) return c.json({ error: 'Capture not found' }, 404);
  const heads = listHeads(db(), true).map((head) => getHeadRow(db(), head.id)).filter((item): item is HeadRow => !!item);
  const result = await evaluateHeads(db(), capture.content, heads, 'manual');
  if (!result) return c.json({ error: 'Jev unavailable or budget capped', budget: canSpendJev(db()) }, 429);
  const embedding = row.embedding
    ? new Float32Array(Buffer.from(row.embedding).buffer, 0, 384)
    : await embed(capture.content);
  const x = buildFeatureVector(embedding, lexicalFeatures(capture.content, null));
  for (const prediction of result.predictions) {
    const head = heads.find((item) => item.id === prediction.headId);
    if (!head) continue;
    insertDecision(db(), {
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
    trainStep(db(), head, x, { valueText: prediction.valueText, valueNum: prediction.valueNum }, 1);
  }
  emit('capture.updated', getCapture(db(), id));
  return c.json({ ok: true, usage: result });
});

apiRoutes.get('/triage', (c) => {
  const now = Date.now();
  const active = listCaptures(db(), { status: 'active', limit: 500 }).captures;
  const withDecisions = active.map((capture) => ({
    capture,
    decisions: db()
      .prepare(
        `SELECT cd.entropy, dh.name AS head_name FROM capture_decisions cd JOIN decision_heads dh ON dh.id = cd.head_id
         WHERE cd.capture_id = ? ORDER BY cd.created_at DESC`,
      )
      .all(capture.id) as Array<{ entropy: number; head_name: string }>,
    energy: effectiveEnergyFor(db(), getCaptureRow(db(), capture.id)!),
  }));
  const uncertain = withDecisions
    .filter((item) => item.decisions.some((decision) => decision.entropy > 0.55))
    .slice(0, 20)
    .map((item) => ({ ...item.capture, decisions: item.decisions }));
  const paradox = listCaptures(db(), { status: 'active', paradoxOnly: true, limit: 50 }).captures;
  const zombies = listReminders(db()).filter((reminder) => reminder.snoozeCount >= 4 || reminder.state === 'notified');
  const threshold = Number(getSetting(db(), 'sublimate_energy', '0.15'));
  const expiring = withDecisions
    .filter((item) => item.energy < threshold * 2 && !item.capture.isPinned)
    .slice(0, 30)
    .map((item) => ({ ...item.capture, effectiveEnergy: item.energy }));
  void now;
  return c.json({ uncertain, paradoxes: paradox, zombies, expiring });
});

apiRoutes.get('/graph', (c) => {
  const rows = listCaptures(db(), { status: 'active', limit: 1000 }).captures;
  const decisions = latestDecisionsFor(db(), rows.map((capture) => capture.id));
  const nodes = rows.map((capture) => ({
    ...capture,
    effectiveEnergy: effectiveEnergyFor(db(), getCaptureRow(db(), capture.id)!),
    decisions: decisions.get(capture.id) ?? [],
  }));
  const rawEdges = db().prepare('SELECT * FROM capture_edges').all() as Array<{
    source_id: string; target_id: string; relation: string; weight: number; meta: string; created_at: number;
  }>;
  const edges = rawEdges.map((row) => ({
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    weight: row.weight,
    meta: JSON.parse(row.meta || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
  }));
  return c.json({ nodes, edges });
});

apiRoutes.get('/heads', (c) => c.json({ heads: listHeads(db()) }));

apiRoutes.post('/heads', async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
  const primitive = body.primitive;
  if (!name) return fail(c, 'name is required');
  if (primitive !== 'choice' && primitive !== 'score' && primitive !== 'noul') return fail(c, 'invalid primitive');
  const configJson =
    primitive === 'score'
      ? { min: 0, max: 3, rubric: { 0: 'low', 1: 'medium', 2: 'high', 3: 'maximum' } }
      : primitive === 'choice'
        ? { options: [{ value: 'yes', description: 'yes' }, { value: 'no', description: 'no' }] }
        : {};
  const id = nanoid();
  try {
    db().prepare(
      `INSERT INTO decision_heads (id, name, primitive, instructions, config_json, auto_escalate, local_threshold,
        sample_count, agreement_count, eval_count, active, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0.86, 0, 0, 0, 1, 0, ?)`,
    ).run(
      id,
      name,
      primitive,
      typeof body.instructions === 'string' ? body.instructions : name,
      JSON.stringify(body.config ?? configJson),
      Date.now(),
    );
  } catch {
    return fail(c, 'a head with that name already exists');
  }
  return c.json(listHeads(db()).find((head) => head.id === id), 201);
});

apiRoutes.patch('/heads/:id', async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return c.json({ error: 'Head not found' }, 404);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.instructions === 'string') { sets.push('instructions = ?'); params.push(body.instructions); }
  if (typeof body.active === 'boolean') { sets.push('active = ?'); params.push(body.active ? 1 : 0); }
  if (typeof body.autoEscalate === 'boolean') { sets.push('auto_escalate = ?'); params.push(body.autoEscalate ? 1 : 0); }
  if (typeof body.localThreshold === 'number') { sets.push('local_threshold = ?'); params.push(body.localThreshold); }
  if (body.config && typeof body.config === 'object') { sets.push('config_json = ?'); params.push(JSON.stringify(body.config)); }
  if (sets.length === 0) return c.json(listHeads(db()).find((item) => item.id === head.id));
  params.push(head.id);
  db().prepare(`UPDATE decision_heads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return c.json(listHeads(db()).find((item) => item.id === head.id));
});

apiRoutes.delete('/heads/:id', (c) => {
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return c.json({ error: 'Head not found' }, 404);
  if (head.is_system === 1) return fail(c, 'system heads cannot be deleted; deactivate them instead');
  db().prepare('DELETE FROM decision_heads WHERE id = ?').run(head.id);
  return c.json({ deleted: true });
});

function sweepIds(head: HeadRow, body: Record<string, unknown>): string[] {
  const where = ['c.status = ?'];
  const params: unknown[] = ['active'];
  if (typeof body.bucket === 'string' && BUCKETS.includes(body.bucket as Bucket)) {
    where.push('c.bucket = ?');
    params.push(body.bucket);
  }
  if (typeof body.days === 'number' && body.days > 0) {
    where.push('c.created_at >= ?');
    params.push(Date.now() - body.days * 86_400_000);
  }
  if (typeof body.minEnergy === 'number') {
    where.push('c.energy >= ?');
    params.push(body.minEnergy);
  }
  if (body.onlyMissing === true) {
    where.push('NOT EXISTS (SELECT 1 FROM capture_decisions cd WHERE cd.capture_id = c.id AND cd.head_id = ?)');
    params.push(head.id);
  }
  return (db().prepare(`SELECT c.id FROM captures c WHERE ${where.join(' AND ')} LIMIT 500`).all(...params) as Array<{ id: string }>).map(
    (row) => row.id,
  );
}

apiRoutes.post('/heads/:id/sweep/preview', async (c) => {
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return c.json({ error: 'Head not found' }, 404);
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const ids = sweepIds(head, body);
  return c.json({ count: ids.length, estimatedUsd: Number((ids.length * 0.0008).toFixed(4)), cap: canSpendJev(db()) });
});

apiRoutes.post('/heads/:id/sweep/run', async (c) => {
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return c.json({ error: 'Head not found' }, 404);
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const ids = sweepIds(head, body);
  void (async () => {
    let done = 0;
    for (const id of ids) {
      if (!canSpendJev(db()).ok) break;
      const capture = getCapture(db(), id);
      const row = getCaptureRow(db(), id);
      if (!capture || !row) continue;
      const result = await evaluateHeads(db(), capture.content, [head], 'sweep');
      if (result) {
        const prediction = result.predictions[0];
        if (prediction) {
          insertDecision(db(), {
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
          const embedding = row.embedding
            ? new Float32Array(Buffer.from(row.embedding).buffer, 0, 384)
            : await embed(capture.content);
          trainStep(db(), head, buildFeatureVector(embedding, lexicalFeatures(capture.content, null)), {
            valueText: prediction.valueText,
            valueNum: prediction.valueNum,
          }, 1);
        }
      }
      done += 1;
      emit('sweep.progress', { headId: head.id, done, total: ids.length });
    }
  })().catch((error: unknown) => console.error('[Sweep] failed:', error));
  return c.json({ started: true, count: ids.length });
});

apiRoutes.post('/heads/test', async (c) => {
  const body = (await jsonBody(c)) as { text?: unknown; useJev?: unknown };
  if (typeof body.text !== 'string' || !body.text.trim()) return fail(c, 'text is required');
  const deterministic = await runDeterministic(body.text);
  const embedding = await embed(deterministic.text);
  const x = buildFeatureVector(embedding, deterministic.features);
  const heads = listHeads(db(), true).map((head) => getHeadRow(db(), head.id)).filter((item): item is HeadRow => !!item);
  const local = heads.map((head) => {
    const started = Date.now();
    const prediction = predictHead(db(), head, x);
    return { headId: head.id, name: head.name, primitive: head.primitive, latencyMs: Date.now() - started, ...prediction };
  });
  let jev = null;
  if (body.useJev === true) jev = await evaluateHeads(db(), deterministic.text, heads, 'manual');
  return c.json({ deterministic, local, jev });
});

apiRoutes.get('/telemetry', (c) => {
  const heads = listHeads(db());
  const headStats = heads.map((head) => ({
    id: head.id,
    name: head.name,
    primitive: head.primitive,
    sampleCount: head.sampleCount,
    evalCount: head.evalCount,
    agreement: head.evalCount > 0 ? head.agreementCount / head.evalCount : 0,
    active: head.active,
  }));
  const usage = jevUsageTotals(db());
  return c.json({
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
    vectorCount: vectorIndex.size(),
    jevMode: getJevMode(db()),
    caps: {
      dailyCalls: config.JEV_DAILY_CALL_CAP,
      dailyUsd: config.JEV_DAILY_USD_CAP,
      monthlyUsd: config.JEV_MONTHLY_USD_CAP,
    },
    usageToday: usage.todayCalls,
    usageTodayUsd: usage.todayUsd,
    usageMonthUsd: usage.monthUsd,
    localHitRate: localHitRate(db()),
    headStats,
    survivalBuckets: survivalBuckets(db()),
    settings: getSettings(db()),
    tags: listTags(db()),
  });
});

apiRoutes.patch('/settings', async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const settable = ['jev_mode', 'bootstrap_target', 'collision_min_cos', 'resonance_min_cos', 'sublimate_energy'];
  for (const [key, value] of Object.entries(body)) {
    if (!settable.includes(key)) continue;
    if (key === 'jev_mode' && value !== 'gated' && value !== 'bootstrap' && value !== 'off') {
      return fail(c, 'jev_mode must be gated, bootstrap or off');
    }
    setSetting(db(), key, String(value));
  }
  emit('telemetry.updated', getSettings(db()));
  return c.json({ settings: getSettings(db()) });
});

apiRoutes.get('/tags', (c) => c.json({ tags: listTags(db()) }));

apiRoutes.onError((error, c) => {
  if (error instanceof ServiceError) return c.json({ error: error.message }, error.status);
  console.error('[API] Unhandled error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

apiRoutes.notFound((c) => c.json({ error: 'API route not found' }, 404));
