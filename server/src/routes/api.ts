import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import {
  BUCKETS, CAPTURE_STATUSES, EDGE_RELATIONS, FIELD_TYPES, bucketCounts, createSavedView,
  deleteEdge, deleteField, deleteFieldValue, deleteSavedView, deleteTemplate, deleteRule,
  fieldFromRow, getCapture, getCaptureDetail, getCaptureRow, getField, getReminder, getRule,
  getSettings, getAgenda, getTemplate, getTriage, listEdgesForCapture,
  listFields, listRules, listSavedViews, listTags, listTemplates, rebuildFts,
  setSetting, templateFromRow, updateSavedView, upsertField,
  upsertRule, upsertTemplate, ruleFromRow,
  type Bucket, type CaptureFilters, type CaptureSort, type FieldSource,
} from '../db/queries.js';
import { getCapturesService, initCapturesService, ServiceError, type ReminderAction } from '../services/captures.service.js';
import { createCaptureManual, ingestBatch, ingestCaptureAuto, mergeCaptures } from '../engine/pipeline.js';
import { dryRunText, executeRuleSweep, previewRuleSweep } from '../engine/rules.js';
import { compileExtraction } from '../engine/extractor.js';
import { applyPatch, patchSchema, previewPatch } from '../engine/patcher.js';
import { findRelatedCaptures } from '../engine/similarity.js';
import { emptyTrash, ttlSweep } from '../engine/scheduler.js';
import { emit, subscribe } from '../services/events.service.js';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { backupSchema, exportBackup, restoreBackup } from '../backup.js';

const db = (): Database.Database => getDatabase();
const captures = () => initCapturesService(db());

const bucketSchema = z.enum(BUCKETS as [Bucket, ...Bucket[]]);
const statusSchema = z.enum(CAPTURE_STATUSES as ['active', 'resolved', 'archived']);
const relationSchema = z.enum(EDGE_RELATIONS as ['reply', 'related', 'refines', 'supports', 'blocks', 'answers']);
const sourceSchema = z.enum(['rule', 'syntax', 'human', 'patch']);
const fieldValueSchema = z.union([
  z.object({ valueText: z.string().nullable().optional(), valueNum: z.number().nullable().optional(), source: sourceSchema.optional() }).strict(),
  z.null(),
]);

const createCaptureSchema = z.preprocess(
  (value) => (value && typeof value === 'object' && !('mode' in value) ? { ...value, mode: 'auto' } : value),
  z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('auto'), content: z.string().min(1), skipUrlFetch: z.boolean().optional() }).strict(),
    z.object({
      mode: z.literal('manual'), content: z.string().min(1),
      bucket: bucketSchema.default('idea'), status: statusSchema.default('active'), isPinned: z.boolean().default(false),
      triaged: z.boolean().optional(), tags: z.array(z.string()).default([]),
      sourceUrl: z.union([z.string().url(), z.null()]).optional(),
      urlTitle: z.string().nullable().optional(), urlExcerpt: z.string().nullable().optional(),
      meta: z.record(z.unknown()).optional(), createdAt: z.number().int().optional(),
      reminderDueAt: z.number().int().nullable().optional(),
      recurrence: z.string().nullable().optional(),
      expiresAt: z.number().int().nullable().optional(),
      expireAction: z.enum(['archive', 'trash', 'delete']).optional(),
      fields: z.record(fieldValueSchema).optional(),
      links: z.array(z.object({ targetId: z.string(), relation: relationSchema, note: z.string().nullable().optional() }).strict()).optional(),
      fetchUrl: z.boolean().optional(),
    }).strict(),
  ]),
);

const updateCaptureSchema = z.object({
  content: z.string().min(1).optional(), bucket: bucketSchema.optional(), status: statusSchema.optional(),
  isPinned: z.boolean().optional(), captureMode: z.enum(['auto', 'manual']).optional(), triaged: z.boolean().optional(),
  touch: z.boolean().optional(),
  expiresAt: z.number().int().nullable().optional(), expireAction: z.enum(['archive', 'trash', 'delete']).optional(),
  tags: z.array(z.string()).optional(), sourceUrl: z.union([z.string().url(), z.null()]).optional(),
  urlTitle: z.string().nullable().optional(), urlExcerpt: z.string().nullable().optional(),
  meta: z.record(z.unknown()).optional(), createdAt: z.number().int().optional(),
  reminder: z.union([
    z.object({
      dueAt: z.number().int(), state: z.enum(['pending', 'notified', 'done', 'killed']).optional(),
      snoozeCount: z.number().int().min(0).optional(), recurrence: z.string().nullable().optional(),
    }).strict(),
    z.null(),
  ]).optional(),
  fields: z.record(fieldValueSchema).optional(),
}).strict();

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('bucket'), value: bucketSchema }),
    z.object({ type: z.literal('status'), value: statusSchema }),
    z.object({ type: z.literal('isPinned'), value: z.boolean() }),
    z.object({ type: z.literal('triaged'), value: z.boolean() }),
    z.object({ type: z.literal('addTags'), value: z.array(z.string()) }),
    z.object({ type: z.literal('removeTags'), value: z.array(z.string()) }),
    z.object({ type: z.literal('setField'), name: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
    z.object({ type: z.literal('trash') }),
    z.object({ type: z.literal('restore') }),
  ]),
}).strict();

function fail(c: Context, message: string, status: 400 | 404 = 400): Response {
  return c.json({ error: message }, status);
}

async function readBody(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  try { return JSON.parse(raw) as unknown; } catch { throw new ServiceError('Request body must be valid JSON'); }
}

function asBool(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === 'true';
}

export const apiRoutes = new Hono();

apiRoutes.get('/health', (c) => c.json({
  ok: true,
  botMode: config.BOT_MODE,
  rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
}));

apiRoutes.use('*', sessionAuth);

apiRoutes.get('/events', (c) => streamSSE(c, async (stream) => {
  let id = 0;
  const unsubscribe = subscribe((event) => {
    void stream.writeSSE({ event: event.type, data: JSON.stringify(event.data), id: String(++id) });
  });
  const heartbeat = setInterval(() => void stream.write(': heartbeat\n\n'), 25_000);
  stream.onAbort(() => { clearInterval(heartbeat); unsubscribe(); });
  await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ok: true }) });
  await new Promise<void>(() => undefined);
}));

apiRoutes.get('/captures', (c) => {
  const query = z.object({
    q: z.string().optional(), bucket: bucketSchema.optional(),
    status: z.union([statusSchema, z.literal('all')]).default('active'), tag: z.string().optional(),
    sort: z.string().optional(), order: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(100), offset: z.coerce.number().int().min(0).default(0),
  }).safeParse(c.req.query());
  if (!query.success) return fail(c, 'Invalid query parameters');
  const filters: CaptureFilters = {
    ...(query.data.q ? { q: query.data.q } : {}),
    ...(query.data.bucket ? { bucket: query.data.bucket } : {}),
    status: query.data.status,
    ...(query.data.tag ? { tag: query.data.tag } : {}),
    ...(query.data.sort ? { sort: query.data.sort as CaptureSort } : {}),
    ...(query.data.order ? { order: query.data.order } : {}),
    limit: query.data.limit, offset: query.data.offset,
  };
  return c.json(captures().list(filters));
});

apiRoutes.post('/captures', async (c) => {
  const parsed = createCaptureSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid capture: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  const body = parsed.data;
  let result;
  if (body.mode === 'manual') {
    result = await createCaptureManual(db(), {
      content: body.content, bucket: body.bucket, status: body.status, isPinned: body.isPinned,
      triaged: body.triaged, tags: body.tags, sourceUrl: body.sourceUrl ?? null,
      urlTitle: body.urlTitle ?? null, urlExcerpt: body.urlExcerpt ?? null, meta: body.meta ?? {},
      createdAt: body.createdAt, reminderDueAt: body.reminderDueAt ?? null, recurrence: body.recurrence ?? null,
      expiresAt: body.expiresAt ?? null, expireAction: body.expireAction ?? 'archive',
      fields: body.fields as Record<string, { valueText?: string | null; valueNum?: number | null } | null> | undefined,
      links: body.links, fetchUrl: body.fetchUrl,
    });
  } else {
    result = await ingestCaptureAuto(db(), { content: body.content, skipUrlFetch: body.skipUrlFetch });
  }
  return c.json(result, 201);
});

apiRoutes.post('/captures/batch', async (c) => {
  const parsed = z.object({
    text: z.string().min(1), delimiter: z.string().min(1).default('\n\n'), skipUrlFetch: z.boolean().default(true),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'text is required');
  const result = await ingestBatch(db(), parsed.data.text, parsed.data.delimiter);
  return c.json(result, 201);
});

apiRoutes.post('/captures/merge', async (c) => {
  const parsed = z.object({
    survivorId: z.string().min(1), absorbIds: z.array(z.string().min(1)).min(1), mergedContent: z.string().optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid merge request');
  const merged = mergeCaptures(db(), parsed.data);
  if (!merged) return fail(c, 'Survivor capture not found', 404);
  return c.json(merged);
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
  const id = c.req.param('id');
  const permanent = c.req.query('permanent') === 'true';
  const removed = permanent ? captures().hardDelete(id) : captures().remove(id);
  if (!removed) return fail(c, 'Capture not found', 404);
  return c.json({ deleted: true, id, permanent });
});

apiRoutes.post('/captures/:id/restore', (c) => {
  if (!captures().restore(c.req.param('id'))) return fail(c, 'Capture is not in trash', 404);
  return c.json({ restored: true, id: c.req.param('id') });
});

apiRoutes.get('/captures/:id/related', (c) => {
  const related = findRelatedCaptures(db(), c.req.param('id'), Math.min(20, Number(c.req.query('limit') ?? 6)));
  return c.json({ related });
});

apiRoutes.post('/captures/:id/reminder/action', async (c) => {
  const parsed = z.object({ action: z.enum(['done', 'snooze1', 'snooze4', 'tomorrow', 'week', 'kill']) }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid reminder action');
  const updated = captures().reminderAction(c.req.param('id'), parsed.data.action as ReminderAction);
  if (!updated) return fail(c, 'Reminder not found', 404);
  return c.json(updated);
});

apiRoutes.post('/captures/:id/override', async (c) => {
  const parsed = z.object({ headId: z.string().min(1), valueText: z.string().nullable().optional(), valueNum: z.number().nullable().optional() }).safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'headId is required');
  const field = getField(db(), parsed.data.headId);
  if (!field) return fail(c, 'Field not found', 404);
  const updated = captures().update(c.req.param('id'), {
    fields: { [field.name]: { valueText: parsed.data.valueText ?? null, valueNum: parsed.data.valueNum ?? null, source: 'human' } },
  });
  if (!updated) return fail(c, 'Capture not found', 404);
  return c.json(updated);
});

apiRoutes.delete('/captures/:id/fields/:name', (c) => {
  const field = getField(db(), c.req.param('name'));
  if (!field) return fail(c, 'Field not found', 404);
  deleteFieldValue(db(), c.req.param('id'), field.id);
  return c.json(captures().get(c.req.param('id')));
});

apiRoutes.post('/captures/:id/fetch-url', async (c) => {
  const parsed = z.object({ url: z.string().url().optional() }).safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid URL');
  const updated = await captures().fetchUrlMetadata(c.req.param('id'), parsed.data.url);
  if (!updated) return fail(c, 'Capture not found', 404);
  return c.json(updated);
});

apiRoutes.post('/captures/:id/edges', async (c) => {
  const parsed = z.object({ targetId: z.string().min(1), relation: relationSchema, note: z.string().nullable().optional() }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid edge');
  try { captures().addEdge(c.req.param('id'), parsed.data.targetId, parsed.data.relation, parsed.data.note); }
  catch (error) { if (error instanceof ServiceError) return fail(c, error.message, error.status); throw error; }
  return c.json({ edges: listEdgesForCapture(db(), c.req.param('id')) }, 201);
});

apiRoutes.delete('/captures/:id/edges', async (c) => {
  const parsed = z.object({ targetId: z.string().min(1), relation: relationSchema }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid edge');
  captures().removeEdge(c.req.param('id'), parsed.data.targetId, parsed.data.relation);
  return c.json({ edges: listEdgesForCapture(db(), c.req.param('id')) });
});

apiRoutes.post('/captures/bulk', async (c) => {
  const parsed = bulkSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid bulk action');
  return c.json(captures().bulkAction(parsed.data.ids, parsed.data.action));
});

apiRoutes.get('/triage', (c) => c.json(getTriage(db())));

apiRoutes.get('/agenda', (c) => c.json(getAgenda(db())));

apiRoutes.get('/fields', (c) => c.json({ fields: listFields(db()) }));

apiRoutes.post('/fields', async (c) => {
  const parsed = z.object({
    id: z.string().min(1).optional(), name: z.string().min(1).max(50), alias: z.string().min(1).max(12).nullable().optional(),
    fieldType: z.enum(FIELD_TYPES as ['score', 'choice', 'boolean', 'text']),
    description: z.string().optional(), config: z.record(z.unknown()).optional(),
    showInStream: z.boolean().optional(), active: z.boolean().optional(), sortOrder: z.number().int().optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid field: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  const data = parsed.data;
  const name = data.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!name) return fail(c, 'name must be a snake_case identifier');
  try {
    return c.json(upsertField(db(), { ...data, id: data.id ?? nanoid(), name, config: data.config ?? {} }), 201);
  } catch { return fail(c, 'A field with that name or alias already exists'); }
});

apiRoutes.patch('/fields/:id', async (c) => {
  const existing = getField(db(), c.req.param('id'));
  if (!existing) return fail(c, 'Field not found', 404);
  const parsed = z.object({
    name: z.string().min(1).max(50).optional(), alias: z.string().min(1).max(12).nullable().optional(),
    fieldType: z.enum(FIELD_TYPES as ['score', 'choice', 'boolean', 'text']).optional(),
    description: z.string().optional(), config: z.record(z.unknown()).optional(),
    showInStream: z.boolean().optional(), active: z.boolean().optional(), sortOrder: z.number().int().optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid field patch');
  try {
    return c.json(upsertField(db(), { id: existing.id, name: parsed.data.name ?? existing.name,
      alias: parsed.data.alias === undefined ? existing.alias : parsed.data.alias,
      fieldType: parsed.data.fieldType ?? existing.fieldType,
      description: parsed.data.description ?? existing.description,
      config: parsed.data.config ?? existing.config,
      showInStream: parsed.data.showInStream ?? existing.showInStream,
      active: parsed.data.active ?? existing.active,
      sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
    }));
  } catch { return fail(c, 'A field with that name or alias already exists'); }
});

apiRoutes.delete('/fields/:id', (c) => {
  if (!deleteField(db(), c.req.param('id'))) return fail(c, 'Field not found', 404);
  return c.json({ deleted: true });
});

apiRoutes.get('/rules', (c) => c.json({ rules: listRules(db()) }));

apiRoutes.post('/rules', async (c) => {
  const parsed = z.object({
    id: z.string().min(1).optional(), name: z.string().min(1).max(120), description: z.string().optional(),
    enabled: z.boolean().optional(), priority: z.number().int().optional(), stopOnMatch: z.boolean().optional(),
    conditions: z.record(z.unknown()), actions: z.record(z.unknown()),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid rule: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  return c.json(upsertRule(db(), { ...parsed.data, id: parsed.data.id ?? nanoid() }), 201);
});

apiRoutes.patch('/rules/:id', async (c) => {
  const existing = getRule(db(), c.req.param('id'));
  if (!existing) return fail(c, 'Rule not found', 404);
  const parsed = z.object({
    name: z.string().min(1).optional(), description: z.string().optional(), enabled: z.boolean().optional(),
    priority: z.number().int().optional(), stopOnMatch: z.boolean().optional(),
    conditions: z.record(z.unknown()).optional(), actions: z.record(z.unknown()).optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid rule patch');
  return c.json(upsertRule(db(), {
    id: existing.id, name: parsed.data.name ?? existing.name, description: parsed.data.description ?? existing.description,
    enabled: parsed.data.enabled ?? existing.enabled, priority: parsed.data.priority ?? existing.priority,
    stopOnMatch: parsed.data.stopOnMatch ?? existing.stopOnMatch,
    conditions: parsed.data.conditions ?? existing.conditions, actions: parsed.data.actions ?? existing.actions,
  }));
});

apiRoutes.delete('/rules/:id', (c) => {
  if (!deleteRule(db(), c.req.param('id'))) return fail(c, 'Rule not found', 404);
  return c.json({ deleted: true });
});

apiRoutes.post('/rules/test', async (c) => {
  const parsed = z.object({ text: z.string().min(1), url: z.string().url().optional() }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'text is required');
  const result = await dryRunText(db(), parsed.data);
  return c.json({ ...result, final: { bucket: result.patch.bucket ?? result.deterministic.bucketHint ?? 'idea', tags: result.patch.addTags ?? [], fields: result.patch.fields ?? {}, expiresAt: result.patch.expiresAt ?? null } });
});

apiRoutes.post('/rules/sweep/preview', async (c) => {
  const parsed = z.object({ ruleId: z.string().optional(), q: z.string().optional() }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid sweep request');
  return c.json(previewRuleSweep(db(), parsed.data.ruleId, parsed.data.q ?? ''));
});

apiRoutes.post('/rules/sweep/run', async (c) => {
  const parsed = z.object({ ruleId: z.string().optional(), q: z.string().optional(), overwriteLocked: z.boolean().default(false) }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid sweep request');
  const result = executeRuleSweep(db(), parsed.data.ruleId, parsed.data.q ?? '', parsed.data.overwriteLocked);
  return c.json(result);
});

apiRoutes.get('/extractors', (c) => c.json({ templates: listTemplates(db()) }));

apiRoutes.post('/extractors', async (c) => {
  const parsed = z.object({
    id: z.string().min(1).optional(), name: z.string().min(1), slug: z.string().min(1), description: z.string().optional(),
    outputMode: z.enum(['clipboard', 'download_md', 'download_json', 'obsidian_uri']).optional(),
    preamble: z.string().optional(), itemTemplate: z.string().optional(), footer: z.string().optional(),
    includeNeighbors: z.boolean().optional(), excludeNoise: z.boolean().optional(),
    isDefault: z.boolean().optional(), sortOrder: z.number().int().optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid template: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  try { return c.json(upsertTemplate(db(), { ...parsed.data, id: parsed.data.id ?? nanoid() }), 201); }
  catch { return fail(c, 'A template with that slug already exists'); }
});

apiRoutes.patch('/extractors/:id', async (c) => {
  const existing = getTemplate(db(), c.req.param('id'));
  if (!existing) return fail(c, 'Template not found', 404);
  const parsed = z.object({
    name: z.string().min(1).optional(), slug: z.string().min(1).optional(), description: z.string().optional(),
    outputMode: z.enum(['clipboard', 'download_md', 'download_json', 'obsidian_uri']).optional(),
    preamble: z.string().optional(), itemTemplate: z.string().optional(), footer: z.string().optional(),
    includeNeighbors: z.boolean().optional(), excludeNoise: z.boolean().optional(),
    isDefault: z.boolean().optional(), sortOrder: z.number().int().optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid template patch');
  try {
    return c.json(upsertTemplate(db(), {
      id: existing.id, name: parsed.data.name ?? existing.name, slug: parsed.data.slug ?? existing.slug,
      description: parsed.data.description ?? existing.description, outputMode: parsed.data.outputMode ?? existing.outputMode,
      preamble: parsed.data.preamble ?? existing.preamble, itemTemplate: parsed.data.itemTemplate ?? existing.itemTemplate,
      footer: parsed.data.footer ?? existing.footer, includeNeighbors: parsed.data.includeNeighbors ?? existing.includeNeighbors,
      excludeNoise: parsed.data.excludeNoise ?? existing.excludeNoise, isDefault: parsed.data.isDefault ?? existing.isDefault,
      sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
    }));
  } catch { return fail(c, 'A template with that slug already exists'); }
});

apiRoutes.delete('/extractors/:id', (c) => {
  if (!deleteTemplate(db(), c.req.param('id'))) return fail(c, 'Template not found', 404);
  return c.json({ deleted: true });
});

apiRoutes.post('/extract', async (c) => {
  const parsed = z.object({
    templateId: z.string().optional(), captureIds: z.array(z.string()).optional(), q: z.string().optional(),
    bucket: bucketSchema.optional(), status: statusSchema.or(z.literal('all')).optional(), tag: z.string().optional(),
    includeNeighbors: z.boolean().optional(),
  }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid extraction request');
  try { return c.json(compileExtraction(db(), parsed.data)); }
  catch (error) { return fail(c, error instanceof Error ? error.message : 'Extraction failed'); }
});

apiRoutes.post('/patch/preview', async (c) => {
  const parsed = z.object({ raw: z.string().min(1) }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'raw patch text is required');
  return c.json(previewPatch(db(), parsed.data.raw));
});

apiRoutes.post('/patch/apply', async (c) => {
  const parsed = z.object({ raw: z.string().optional(), patch: patchSchema.optional(), selectedIds: z.array(z.string()).optional() }).strict().safeParse(await readBody(c));
  if (!parsed.success || (!parsed.data.raw && !parsed.data.patch)) return fail(c, 'raw patch text or patch object is required');
  const patch = parsed.data.patch ?? (await import('../engine/patcher.js')).parsePatch(parsed.data.raw!).patch;
  return c.json(applyPatch(db(), patch, parsed.data.selectedIds));
});

apiRoutes.get('/settings', (c) => c.json({ settings: getSettings(db()) }));

apiRoutes.patch('/settings', async (c) => {
  const parsed = z.record(z.union([z.string(), z.number(), z.boolean()])).safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Settings must be a map of string, number or boolean values');
  for (const [key, value] of Object.entries(parsed.data)) setSetting(db(), key, String(value));
  const settings = getSettings(db());
  emit('telemetry.updated', settings);
  return c.json({ settings });
});

apiRoutes.post('/system/maintenance', async (c) => {
  const parsed = z.object({ action: z.enum(['rebuild_fts', 'vacuum', 'empty_trash', 'run_ttl']) }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid maintenance action');
  const action = parsed.data.action;
  if (action === 'rebuild_fts') return c.json({ rebuilt: rebuildFts(db()) });
  if (action === 'vacuum') { db().exec('VACUUM'); return c.json({ vacuumed: true }); }
  if (action === 'empty_trash') return c.json({ purged: emptyTrash(db()) });
  return c.json({ expired: ttlSweep(db()) });
});

apiRoutes.post('/import/json', async (c) => {
  const parsed = backupSchema.safeParse(await readBody(c));
  if (!parsed.success) return fail(c, `Invalid backup: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  const imported = restoreBackup(db(), parsed.data);
  emit('capture.bulk', { imported });
  return c.json({ imported });
});

apiRoutes.get('/views', (c) => c.json({ views: listSavedViews(db()) }));

apiRoutes.post('/views', async (c) => {
  const parsed = z.object({ name: z.string().min(1).max(80), query: z.string().default(''), sort: z.string().default('recent'), sortOrder: z.number().int().default(0) }).strict().safeParse(await readBody(c));
  if (!parsed.success) return fail(c, 'Invalid view');
  return c.json(createSavedView(db(), { id: nanoid(), ...parsed.data }), 201);
});

apiRoutes.patch('/views/:id', async (c) => {
  const parsed = z.object({ name: z.string().min(1).optional(), query: z.string().optional(), sort: z.string().optional(), sortOrder: z.number().int().optional() }).strict().safeParse(await readBody(c));
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
  const stats = db().prepare(
    `SELECT bucket, COUNT(*) AS count FROM captures WHERE deleted_at IS NULL GROUP BY bucket`,
  ).all() as Array<{ bucket: string; count: number }>;
  const fieldCounts = db().prepare(
    `SELECT f.name, COUNT(cf.capture_id) AS count FROM custom_fields f LEFT JOIN capture_fields cf ON cf.field_id = f.id GROUP BY f.id`,
  ).all() as Array<{ name: string; count: number }>;
  return c.json({
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
    activeCaptures: (db().prepare('SELECT COUNT(*) AS count FROM captures WHERE deleted_at IS NULL').get() as { count: number }).count,
    untriaged: (db().prepare("SELECT COUNT(*) AS count FROM captures WHERE deleted_at IS NULL AND triaged = 0 AND status = 'active'").get() as { count: number }).count,
    trashCount: (db().prepare('SELECT COUNT(*) AS count FROM captures WHERE deleted_at IS NOT NULL').get() as { count: number }).count,
    rules: listRules(db()).length,
    ruleHits: listRules(db()).reduce((sum, rule) => sum + rule.hitCount, 0),
    dbSizeMb: Number((db().prepare("SELECT page_count * page_size / 1048576.0 AS size FROM pragma_page_count(), pragma_page_size()").get() as { size: number }).size.toFixed(2)),
    bucketCounts: bucketCounts(db()),
    fieldCounts,
    bucketStats: stats,
    settings: getSettings(db()),
    tags: listTags(db()),
  });
});

apiRoutes.get('/export', (c) => {
  const format = z.enum(['json', 'md']).safeParse(c.req.query('format') ?? 'json');
  if (!format.success) return fail(c, 'format must be json or md');
  const backup = exportBackup(db(), c.req.query('includeTrash') === 'true');
  if (format.data === 'json') {
    return c.body(JSON.stringify(backup), 200, {
      'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="blinko-backup.json"',
    });
  }
  const lines = backup.captures.map((capture) => `## [${capture.bucket}] ${new Date(capture.createdAt).toISOString()}\n\n${capture.content}`);
  return c.body(`# BLINKO//OS export\n\n${lines.join('\n\n')}\n`, 200, {
    'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="blinko-backup.md"',
  });
});

apiRoutes.onError((error, c) => {
  if (error instanceof ServiceError) return c.json({ error: error.message }, error.status);
  console.error('[API] Unhandled error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

apiRoutes.notFound((c) => c.json({ error: 'API route not found' }, 404));
