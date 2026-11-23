import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import {
  createSavedView,
  deleteSavedView,
  getCaptureDetail,
  getHeadRow,
  getReminder,
  getReviewQueue,
  getSettings,
  getAgenda,
  headFromRow,
  jevUsageTotals,
  listCaptures,
  listEdgesForCapture,
  listHeads,
  listSavedViews,
  listTags,
  setSetting,
  updateSavedView,
  type Bucket,
  type CaptureFilters,
  type CaptureSort,
  type EdgeRelation,
  type HeadRow,
} from '../db/queries.js';
import { getCapturesService, initCapturesService, ServiceError } from '../services/captures.service.js';
import { createCaptureManual, ingestCaptureAuto, type PipelineResult } from '../engine/pipeline.js';
import { runDeterministic } from '../engine/deterministic.js';
import { canSpendJev, estimateSweepCostUsd, evaluateHeads, getJevMode } from '../engine/jev.js';
import { emit, subscribe } from '../services/events.service.js';
import { sessionAuth } from '../middleware/sessionAuth.js';

const db = (): Database.Database => getDatabase();
const captures = () => initCapturesService(db());

const bucketSchema = z.enum(['idea', 'memory', 'reminder', 'question', 'reference', 'noise']);
const statusSchema = z.enum(['active', 'resolved', 'archived']);
const relationSchema = z.enum(['reply', 'related', 'refines', 'supports', 'blocks', 'answers']);
const sourceUrlSchema = z.union([z.string().url(), z.null()]);
const metaSchema = z.record(z.unknown());
const decisionPatchSchema = z.union([
  z.object({ valueText: z.string().nullable().optional(), valueNum: z.number().nullable().optional() }).strict(),
  z.null(),
]);

const createCaptureSchema = z.preprocess(
  (value) => (value && typeof value === 'object' && !('mode' in value) ? { ...value, mode: 'auto' } : value),
  z.discriminatedUnion('mode', [
    z
      .object({
        mode: z.literal('auto'),
        content: z.string().min(1),
        skipUrlFetch: z.boolean().optional(),
        forceJev: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        mode: z.literal('manual'),
        content: z.string().min(1),
        bucket: bucketSchema.default('idea'),
        status: statusSchema.default('active'),
        isPinned: z.boolean().default(false),
        tags: z.array(z.string()).default([]),
        sourceUrl: sourceUrlSchema.optional(),
        urlTitle: z.string().nullable().optional(),
        urlExcerpt: z.string().nullable().optional(),
        meta: metaSchema.optional(),
        createdAt: z.number().int().optional(),
        reminderDueAt: z.number().int().nullable().optional(),
        decisions: z.record(decisionPatchSchema).optional(),
        links: z
          .array(
            z
              .object({ targetId: z.string(), relation: relationSchema, note: z.string().nullable().optional() })
              .strict(),
          )
          .optional(),
        fetchUrl: z.boolean().optional(),
      })
      .strict(),
  ]),
);

const updateCaptureSchema = z
  .object({
    content: z.string().min(1).optional(),
    bucket: bucketSchema.optional(),
    status: statusSchema.optional(),
    isPinned: z.boolean().optional(),
    captureMode: z.enum(['auto', 'manual']).optional(),
    tags: z.array(z.string()).optional(),
    sourceUrl: sourceUrlSchema.optional(),
    urlTitle: z.string().nullable().optional(),
    urlExcerpt: z.string().nullable().optional(),
    meta: metaSchema.optional(),
    createdAt: z.number().int().optional(),
    reminder: z
      .union([
        z
          .object({
            dueAt: z.number().int(),
            state: z.enum(['pending', 'notified', 'done', 'killed']).optional(),
            snoozeCount: z.number().int().min(0).optional(),
          })
          .strict(),
        z.null(),
      ])
      .optional(),
    decisions: z.record(decisionPatchSchema).optional(),
  })
  .strict();

const bulkActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bucket'), value: bucketSchema }),
  z.object({ type: z.literal('status'), value: statusSchema }),
  z.object({ type: z.literal('isPinned'), value: z.boolean() }),
  z.object({ type: z.literal('addTags'), value: z.array(z.string()) }),
  z.object({ type: z.literal('removeTags'), value: z.array(z.string()) }),
  z.object({ type: z.literal('delete') }),
  z.object({ type: z.literal('runJev') }),
]);
const bulkSchema = z.object({ ids: z.array(z.string()).min(1), action: bulkActionSchema }).strict();

const choiceConfigSchema = z
  .object({
    options: z
      .array(z.object({ value: z.string().min(1), description: z.string().optional().default('') }).strict())
      .min(1)
      .max(20),
  })
  .strict();
const scoreConfigSchema = z
  .object({
    min: z.number().int().min(0),
    max: z.number().int(),
    rubric: z.record(z.string()),
  })
  .strict()
  .refine((config) => config.max > config.min && config.max - config.min <= 9, {
    message: 'score range must contain 2–10 levels',
  });
const noulConfigSchema = z.object({}).strict();

const headBase = {
  name: z.string().min(1).max(50),
  instructions: z.string().min(1),
  entropyThreshold: z.number().min(0).max(1).default(0.55),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
};
const createHeadSchema = z.discriminatedUnion('primitive', [
  z.object({ ...headBase, primitive: z.literal('choice'), config: choiceConfigSchema }).strict(),
  z.object({ ...headBase, primitive: z.literal('score'), config: scoreConfigSchema }).strict(),
  z.object({ ...headBase, primitive: z.literal('noul'), config: noulConfigSchema }).strict(),
]);

const sweepSchema = z
  .object({ q: z.string().optional(), onlyMissing: z.boolean().default(false) })
  .strict();

const viewSchema = z
  .object({
    name: z.string().min(1).max(80),
    query: z.string().default(''),
    sort: z.string().default('recent'),
    sortOrder: z.number().int().default(0),
  })
  .strict();

function fail(c: Context, message: string, status: 400 | 404 | 429 = 400): Response {
  return c.json({ error: message }, status);
}

async function readBody(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ServiceError('Request body must be valid JSON');
  }
}

function validateHeadConfig(primitive: 'choice' | 'score' | 'noul', value: unknown): Record<string, unknown> {
  const schema = primitive === 'choice' ? choiceConfigSchema : primitive === 'score' ? scoreConfigSchema : noulConfigSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ServiceError(`Invalid ${primitive} config: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data as Record<string, unknown>;
}

function normalizeHeadName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

export const apiRoutes = new Hono();

apiRoutes.get('/health', (c) =>
  c.json({
    ok: true,
    botMode: config.BOT_MODE,
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
    jevMode: getJevMode(db()),
    jevModel: config.JEV_MODEL,
  }),
);

apiRoutes.use('*', sessionAuth);

apiRoutes.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    let id = 0;
    const unsubscribe = subscribe((event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event.data), id: String(++id) });
    });
    const heartbeat = setInterval(() => void stream.write(': heartbeat\n\n'), 25_000);
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ok: true }) });
    await new Promise<void>(() => undefined);
  }),
);

apiRoutes.get('/captures', (c) => {
  const query = z
    .object({
      q: z.string().optional(),
      bucket: bucketSchema.optional(),
      status: z.union([statusSchema, z.literal('all')]).default('active'),
      tag: z.string().optional(),
      sort: z.union([z.enum(['recent', 'updated', 'due', 'entropy']), z.string().startsWith('head:')]).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse(c.req.query());
  if (!query.success) return fail(c, 'Invalid query parameters');
  const filters: CaptureFilters = {
    ...(query.data.q ? { q: query.data.q } : {}),
    ...(query.data.bucket ? { bucket: query.data.bucket } : {}),
    status: query.data.status,
    ...(query.data.tag ? { tag: query.data.tag } : {}),
    ...(query.data.sort ? { sort: query.data.sort as CaptureSort } : {}),
    ...(query.data.order ? { order: query.data.order } : {}),
    limit: query.data.limit,
    offset: query.data.offset,
  };
  return c.json(captures().list(filters));
});

apiRoutes.post('/captures/bulk', async (c) => {
  const parsed = bulkSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid bulk action');
  return c.json(await captures().bulkAction(parsed.data.ids, parsed.data.action));
});

apiRoutes.post('/captures', async (c) => {
  const parsed = createCaptureSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid capture: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  const body = parsed.data;
  let result: PipelineResult;
  if (body.mode === 'manual') {
    result = await createCaptureManual(db(), {
      content: body.content,
      bucket: body.bucket,
      status: body.status,
      isPinned: body.isPinned,
      tags: body.tags,
      sourceUrl: body.sourceUrl ?? null,
      urlTitle: body.urlTitle ?? null,
      urlExcerpt: body.urlExcerpt ?? null,
      meta: body.meta ?? {},
      createdAt: body.createdAt,
      reminderDueAt: body.reminderDueAt ?? null,
      decisions: body.decisions,
      links: body.links,
      fetchUrl: body.fetchUrl,
    });
  } else {
    result = await ingestCaptureAuto(db(), {
      content: body.content,
      skipUrlFetch: body.skipUrlFetch,
      forceJev: body.forceJev,
    });
  }
  return c.json(result, 201);
});

apiRoutes.get('/captures/:id', (c) => {
  const detail = getCaptureDetail(db(), c.req.param('id'));
  if (!detail) return fail(c, 'Capture not found', 404);
  return c.json({ ...detail, reminder: getReminder(db(), detail.id) ?? null });
});

apiRoutes.patch('/captures/:id', async (c) => {
  const parsed = updateCaptureSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid patch: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  const updated = captures().update(c.req.param('id'), parsed.data);
  if (!updated) return fail(c, 'Capture not found', 404);
  return c.json(updated);
});

apiRoutes.delete('/captures/:id', (c) => {
  if (!captures().remove(c.req.param('id'))) return fail(c, 'Capture not found', 404);
  return c.json({ deleted: true, id: c.req.param('id') });
});

apiRoutes.post('/captures/:id/override', async (c) => {
  const parsed = z
    .object({
      headId: z.string().min(1),
      valueText: z.string().nullable().optional(),
      valueNum: z.number().nullable().optional(),
    })
    .safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'headId is required');
  const updated = captures().override(
    c.req.param('id'),
    parsed.data.headId,
    parsed.data.valueText ?? undefined,
    parsed.data.valueNum ?? undefined,
  );
  if (!updated) return fail(c, 'Capture not found', 404);
  return c.json(updated);
});

apiRoutes.delete('/captures/:id/decisions/:headId', (c) => {
  const updated = captures().clearDecision(c.req.param('id'), c.req.param('headId'));
  if (!updated) return fail(c, 'Capture not found', 404);
  return c.json(updated);
});

apiRoutes.post('/captures/:id/jev', async (c) => {
  const parsed = z.object({ headIds: z.array(z.string()).optional() }).safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid Jev request');
  try {
    const result = await captures().reevaluateWithJev(c.req.param('id'), parsed.data.headIds);
    if (!result) return fail(c, 'Capture not found', 404);
    return c.json(result);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 429) return fail(c, error.message, 429);
    throw error;
  }
});

apiRoutes.post('/captures/:id/fetch-url', async (c) => {
  const parsed = z.object({ url: z.string().url().optional() }).safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid URL');
  const updated = await captures().fetchUrlMetadata(c.req.param('id'), parsed.data.url);
  if (!updated) return fail(c, 'Capture not found', 404);
  return c.json(updated);
});

apiRoutes.post('/captures/:id/edges', async (c) => {
  const parsed = z
    .object({ targetId: z.string().min(1), relation: relationSchema, note: z.string().nullable().optional() })
    .strict()
    .safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid edge');
  try {
    captures().addEdge(c.req.param('id'), parsed.data.targetId, parsed.data.relation, parsed.data.note);
  } catch (error) {
    if (error instanceof ServiceError) return fail(c, error.message, error.status);
    throw error;
  }
  return c.json({ edges: listEdgesForCapture(db(), c.req.param('id')) }, 201);
});

apiRoutes.delete('/captures/:id/edges', async (c) => {
  const parsed = z
    .object({ targetId: z.string().min(1), relation: relationSchema })
    .strict()
    .safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid edge');
  captures().removeEdge(c.req.param('id'), parsed.data.targetId, parsed.data.relation);
  return c.json({ edges: listEdgesForCapture(db(), c.req.param('id')) });
});

apiRoutes.get('/review', (c) => c.json(getReviewQueue(db())));

apiRoutes.get('/agenda', (c) => c.json(getAgenda(db())));

apiRoutes.get('/heads', (c) => c.json({ heads: listHeads(db()) }));

apiRoutes.post('/heads/test', async (c) => {
  const parsed = z
    .object({
      text: z.string().min(1),
      url: z.string().url().optional(),
      headIds: z.array(z.string()).optional(),
    })
    .strict()
    .safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'text is required');
  const deterministic = await runDeterministic(parsed.data.text);
  const heads = (parsed.data.headIds ?? [])
    .flatMap((key) => {
      const head = getHeadRow(db(), key) ?? db().prepare('SELECT * FROM decision_heads WHERE name = ?').get(key);
      return head ? [head as HeadRow] : [];
    })
    .filter((head) => head.active === 1);
  const activeHeads = heads.length > 0 ? heads : listHeads(db(), true).map((head) => getHeadRow(db(), head.id)!).filter(Boolean);
  const state = {
    content: deterministic.text,
    tags: deterministic.tags,
    ...(deterministic.sourceUrl
      ? {
          url: {
            url: deterministic.sourceUrl,
            title: deterministic.urlTitle ?? '',
            excerpt: deterministic.urlExcerpt ?? '',
          },
        }
      : parsed.data.url
        ? { url: { url: parsed.data.url, title: '', excerpt: '' } }
        : {}),
  };
  const jev = await evaluateHeads(db(), state, activeHeads, 'playground');
  return c.json({ deterministic, jev });
});

apiRoutes.post('/heads', async (c) => {
  const parsed = createHeadSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid head: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  const data = parsed.data;
  const name = normalizeHeadName(data.name);
  if (!name) return fail(c, 'name is required');
  const id = nanoid();
  try {
    db()
      .prepare(
        `INSERT INTO decision_heads
           (id, name, primitive, instructions, config_json, entropy_threshold, active, is_system, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        name,
        data.primitive,
        data.instructions,
        JSON.stringify(data.config),
        data.entropyThreshold,
        data.active ? 1 : 0,
        data.sortOrder,
        Date.now(),
      );
  } catch {
    return fail(c, 'a head with that name already exists');
  }
  const head = getHeadRow(db(), id);
  return c.json(head ? headFromRow(head) : null, 201);
});

apiRoutes.patch('/heads/:id', async (c) => {
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return fail(c, 'Head not found', 404);
  const parsed = z
    .object({
      name: z.string().min(1).max(50).optional(),
      instructions: z.string().min(1).optional(),
      primitive: z.enum(['choice', 'score', 'noul']).optional(),
      config: z.unknown().optional(),
      entropyThreshold: z.number().min(0).max(1).optional(),
      sortOrder: z.number().int().optional(),
      active: z.boolean().optional(),
    })
    .strict()
    .safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid head patch');
  const primitive = parsed.data.primitive ?? head.primitive;
  let config: Record<string, unknown> | undefined;
  try {
    if (parsed.data.config !== undefined) config = validateHeadConfig(primitive, parsed.data.config);
    else if (primitive !== head.primitive) config = validateHeadConfig(primitive, JSON.parse(head.config_json) as unknown);
  } catch (error) {
    return fail(c, error instanceof Error ? error.message : 'Invalid config');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.name !== undefined) {
    sets.push('name = ?');
    params.push(normalizeHeadName(parsed.data.name));
  }
  if (parsed.data.instructions !== undefined) {
    sets.push('instructions = ?');
    params.push(parsed.data.instructions);
  }
  if (parsed.data.primitive !== undefined) {
    sets.push('primitive = ?');
    params.push(primitive);
  }
  if (config !== undefined) {
    sets.push('config_json = ?');
    params.push(JSON.stringify(config));
  }
  if (parsed.data.entropyThreshold !== undefined) {
    sets.push('entropy_threshold = ?');
    params.push(parsed.data.entropyThreshold);
  }
  if (parsed.data.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    params.push(parsed.data.sortOrder);
  }
  if (parsed.data.active !== undefined) {
    sets.push('active = ?');
    params.push(parsed.data.active ? 1 : 0);
  }
  if (sets.length > 0) {
    params.push(head.id);
    db().prepare(`UPDATE decision_heads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  const updated = getHeadRow(db(), head.id);
  return c.json(updated ? headFromRow(updated) : null);
});

apiRoutes.delete('/heads/:id', (c) => {
  const result = db().prepare('DELETE FROM decision_heads WHERE id = ?').run(c.req.param('id'));
  if (result.changes === 0) return fail(c, 'Head not found', 404);
  return c.json({ deleted: true });
});

function sweepTargets(head: HeadRow, q: string, onlyMissing: boolean): Array<{ id: string; content: string }> {
  const page = listCaptures(db(), { q, status: 'active', limit: 500 });
  return page.captures
    .filter((capture) => !onlyMissing || !Object.values(capture.decisions).some((decision) => decision.headId === head.id))
    .map((capture) => ({ id: capture.id, content: capture.content }));
}

apiRoutes.post('/heads/:id/sweep/preview', async (c) => {
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return fail(c, 'Head not found', 404);
  const parsed = sweepSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid sweep request');
  const targets = sweepTargets(head, parsed.data.q ?? '', parsed.data.onlyMissing);
  const instructionsChars = head.instructions.length + head.config_json.length;
  return c.json({
    count: targets.length,
    estimatedUsd: estimateSweepCostUsd(
      targets.map((target) => target.content),
      instructionsChars,
    ),
    cap: canSpendJev(db()),
  });
});

apiRoutes.post('/heads/:id/sweep/run', async (c) => {
  const head = getHeadRow(db(), c.req.param('id'));
  if (!head) return fail(c, 'Head not found', 404);
  const parsed = sweepSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid sweep request');
  const targets = sweepTargets(head, parsed.data.q ?? '', parsed.data.onlyMissing);
  void (async () => {
    let done = 0;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const target = targets[cursor];
        cursor += 1;
        if (!target) continue;
        try {
          await captures().reevaluateWithJev(target.id, [head.id]);
        } catch {
          // Individual failures are surfaced by the Jev call itself.
        }
        done += 1;
        emit('sweep.progress', { headId: head.id, done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, targets.length) }, () => worker()));
  })().catch((error: unknown) => console.error('[Sweep] failed:', error));
  return c.json({ started: true, count: targets.length });
});

apiRoutes.get('/views', (c) => c.json({ views: listSavedViews(db()) }));

apiRoutes.post('/views', async (c) => {
  const parsed = viewSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid view');
  const view = createSavedView(db(), { id: nanoid(), ...parsed.data });
  return c.json(view, 201);
});

apiRoutes.patch('/views/:id', async (c) => {
  const parsed = viewSchema.partial().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid view patch');
  const view = updateSavedView(db(), c.req.param('id'), parsed.data);
  if (!view) return fail(c, 'View not found', 404);
  return c.json(view);
});

apiRoutes.delete('/views/:id', (c) => {
  if (!deleteSavedView(db(), c.req.param('id'))) return fail(c, 'View not found', 404);
  return c.json({ deleted: true });
});

apiRoutes.get('/telemetry', (c) => {
  const usage = jevUsageTotals(db());
  const headRows = listHeads(db());
  const stats = db()
    .prepare(
      `SELECT head_id, COUNT(*) AS decisions, AVG(entropy) AS avg_entropy, AVG(confidence) AS avg_confidence
       FROM capture_decisions GROUP BY head_id`,
    )
    .all() as Array<{ head_id: string; decisions: number; avg_entropy: number; avg_confidence: number }>;
  const statMap = new Map(stats.map((stat) => [stat.head_id, stat]));
  const headStats = headRows.map((head) => ({
    id: head.id,
    name: head.name,
    primitive: head.primitive,
    active: head.active,
    entropyThreshold: head.entropyThreshold,
    decisions: statMap.get(head.id)?.decisions ?? 0,
    avgEntropy: statMap.get(head.id)?.avg_entropy ?? 0,
    avgConfidence: statMap.get(head.id)?.avg_confidence ?? 0,
  }));
  return c.json({
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
    jevMode: getJevMode(db()),
    jevModel: config.JEV_MODEL,
    caps: {
      dailyCalls: config.JEV_DAILY_CALL_CAP,
      dailyUsd: config.JEV_DAILY_USD_CAP,
      monthlyUsd: config.JEV_MONTHLY_USD_CAP,
      priceUsdPerMillion: 0.042,
    },
    usageToday: usage.todayCalls,
    usageTodayUsd: usage.todayUsd,
    usageMonthUsd: usage.monthUsd,
    totalCaptures: (db().prepare('SELECT COUNT(*) AS count FROM captures').get() as { count: number }).count,
    bucketCounts: captures().list({ status: 'all', limit: 1 }).bucketCounts,
    headStats,
    settings: getSettings(db()),
    tags: listTags(db()),
  });
});

apiRoutes.patch('/settings', async (c) => {
  const parsed = z
    .object({ jev_mode: z.enum(['auto', 'off']) })
    .strict()
    .safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'jev_mode must be auto or off');
  setSetting(db(), 'jev_mode', parsed.data.jev_mode);
  const settings = getSettings(db());
  emit('telemetry.updated', settings);
  return c.json({ settings });
});

apiRoutes.get('/export', (c) => {
  const format = z.enum(['json', 'md']).safeParse(c.req.query('format') ?? 'json');
  if (!format.success) return fail(c, 'format must be json or md');
  const payload = {
    exportedAt: new Date().toISOString(),
    captures: captures().list({ status: 'all', limit: 500 }).captures,
    tags: db().prepare('SELECT name FROM tags ORDER BY name').all(),
    decisions: db().prepare('SELECT * FROM capture_decisions').all(),
    reminders: db().prepare('SELECT * FROM reminders').all(),
    edges: db().prepare('SELECT * FROM capture_edges').all(),
  };
  if (format.data === 'json') {
    return c.body(JSON.stringify(payload), 200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="blinko-backup.json"',
    });
  }
  const lines = payload.captures.map((capture) => `## [${capture.bucket}] ${new Date(capture.createdAt).toISOString()}\n\n${capture.content}`);
  const markdown = `# BLINKO//OS export\n\n${lines.join('\n\n')}\n`;
  return c.body(markdown, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': 'attachment; filename="blinko-backup.md"',
  });
});

apiRoutes.onError((error, c) => {
  if (error instanceof ServiceError) return c.json({ error: error.message }, error.status);
  console.error('[API] Unhandled error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

apiRoutes.notFound((c) => c.json({ error: 'API route not found' }, 404));
