import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  listCaptures, listFields, listRules, listSavedViews, listTemplates, getSettings,
  insertEdge, setCaptureTags, syncCaptureFts, upsertReminder,
  BUCKETS, CAPTURE_STATUSES, EDGE_RELATIONS, FIELD_TYPES,
  type Bucket, type Capture, type CaptureStatus, type EdgeRelation, type FieldType,
} from './db/queries.js';

const jsonRecord = z.record(z.unknown());
const booleanish = ['showInStream', 'active', 'enabled', 'stopOnMatch', 'isPinned', 'triaged', 'isDefault', 'includeNeighbors', 'excludeNoise', 'locked'];

// Old backups used raw snake_case rows; normalize them to the v2 camelCase shape.
function normalizeRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  for (const key of booleanish) if (typeof out[key] === 'number') out[key] = out[key] === 1;
  for (const [target, source] of [['config', 'configJson'], ['conditions', 'conditionsJson'], ['actions', 'actionsJson']] as const) {
    if (out[target] === undefined && typeof out[source] === 'string') {
      try { out[target] = JSON.parse(out[source] as string); } catch { out[target] = {}; }
    }
  }
  return out;
}

const reminderSchema = z.object({
  dueAt: z.number(), state: z.enum(['pending', 'notified', 'done', 'killed']).optional(),
  snoozeCount: z.number().optional(), recurrence: z.string().nullable().optional(),
  lastNotifiedAt: z.number().nullable().optional(),
}).passthrough();

const fieldValueSchema = z.object({
  valueText: z.string().nullable().optional(), valueNum: z.number().nullable().optional(),
  source: z.enum(['rule', 'syntax', 'human', 'patch']).optional(), locked: z.boolean().optional(),
  updatedAt: z.number().optional(),
}).passthrough();

const captureSchema = z.object({
  id: z.string(), content: z.string(), bucket: z.enum(BUCKETS as [Bucket, ...Bucket[]]).default('idea'),
  status: z.enum(CAPTURE_STATUSES as [CaptureStatus, ...CaptureStatus[]]).default('active'),
  isPinned: z.boolean().optional(), captureMode: z.enum(['auto', 'manual']).optional(), triaged: z.boolean().optional(),
  sourceUrl: z.string().nullable().optional(), urlTitle: z.string().nullable().optional(), urlExcerpt: z.string().nullable().optional(),
  meta: jsonRecord.optional(), expiresAt: z.number().nullable().optional(), expireAction: z.enum(['archive', 'trash', 'delete']).optional(),
  deletedAt: z.number().nullable().optional(), createdAt: z.number(), updatedAt: z.number().optional(),
  tags: z.array(z.string()).default([]), fields: z.record(fieldValueSchema).default({}),
  reminder: reminderSchema.nullable().optional(),
}).passthrough();

const fieldSchema = z.object({
  id: z.string(), name: z.string(), alias: z.string().nullable().optional(),
  fieldType: z.enum(FIELD_TYPES as [FieldType, ...FieldType[]]), description: z.string().optional(),
  config: jsonRecord.optional(), showInStream: z.boolean().optional(), active: z.boolean().optional(),
  sortOrder: z.number().optional(), createdAt: z.number().optional(),
}).passthrough();

const ruleSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional(), enabled: z.boolean().optional(),
  priority: z.number().optional(), stopOnMatch: z.boolean().optional(), conditions: jsonRecord.default({}),
  actions: jsonRecord.default({}), hitCount: z.number().optional(), createdAt: z.number().optional(), updatedAt: z.number().optional(),
}).passthrough();

const templateSchema = z.object({
  id: z.string(), name: z.string(), slug: z.string(), description: z.string().optional(),
  outputMode: z.enum(['clipboard', 'download_md', 'download_json', 'obsidian_uri']).optional(),
  preamble: z.string().optional(), itemTemplate: z.string().optional(), footer: z.string().optional(),
  includeNeighbors: z.boolean().optional(), excludeNoise: z.boolean().optional(), isDefault: z.boolean().optional(),
  sortOrder: z.number().optional(), createdAt: z.number().optional(), updatedAt: z.number().optional(),
}).passthrough();

const viewSchema = z.object({
  id: z.string(), name: z.string(), query: z.string().optional(), sort: z.string().optional(),
  sortOrder: z.number().optional(), createdAt: z.number().optional(),
}).passthrough();

/** One versioned shape for both download and restore. */
export const backupSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return value;
    const raw = value as Record<string, unknown>;
    const rows = (key: string) => Array.isArray(raw[key]) ? (raw[key] as unknown[]).map(normalizeRow) : raw[key];
    return {
      ...raw,
      captures: Array.isArray(raw.captures) ? raw.captures.map((row) => {
        const capture = normalizeRow(row);
        if (capture.fields && typeof capture.fields === 'object') {
          capture.fields = Object.fromEntries(Object.entries(capture.fields as Record<string, unknown>).map(([name, field]) => [name, normalizeRow(field)]));
        }
        return capture;
      }) : raw.captures,
      fields: rows('fields'), rules: rows('rules'), extractors: rows('extractors'), views: rows('views'),
      edges: Array.isArray(raw.edges) ? (raw.edges as unknown[]).map(normalizeRow) : raw.edges,
    };
  },
  z.object({
    version: z.literal(2).default(2),
    exportedAt: z.string().optional(),
    captures: z.array(captureSchema).default([]),
    fields: z.array(fieldSchema).default([]),
    rules: z.array(ruleSchema).default([]),
    extractors: z.array(templateSchema).default([]),
    views: z.array(viewSchema).default([]),
    edges: z.array(z.object({
      sourceId: z.string(), targetId: z.string(), relation: z.enum(EDGE_RELATIONS as [EdgeRelation, ...EdgeRelation[]]),
      note: z.string().nullable().optional(), createdAt: z.number().optional(),
    }).passthrough()).default([]),
    settings: z.record(z.string()).default({}),
  }),
);

export type Backup = z.infer<typeof backupSchema>;

export function exportBackup(db: Database.Database, includeTrash = false): Backup {
  const captures: Capture[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = listCaptures(db, { status: 'all', includeTrash, limit: 5000, offset });
    captures.push(...page.captures);
    if (page.captures.length < 5000) break;
  }
  const edges = (db.prepare('SELECT source_id, target_id, relation, note, created_at FROM capture_edges ORDER BY created_at').all() as Array<{
    source_id: string; target_id: string; relation: Backup['edges'][number]['relation']; note: string | null; created_at: number;
  }>).map((row) => ({ sourceId: row.source_id, targetId: row.target_id, relation: row.relation, note: row.note, createdAt: row.created_at }));
  return backupSchema.parse({
    version: 2, exportedAt: new Date().toISOString(), captures,
    fields: listFields(db), rules: listRules(db), extractors: listTemplates(db), views: listSavedViews(db),
    edges, settings: getSettings(db),
  } as unknown) as Backup;
}

export function restoreBackup(db: Database.Database, backup: Backup): number {
  const now = Date.now();
  db.transaction(() => {
    for (const field of backup.fields) {
      db.prepare(
        `INSERT INTO custom_fields (id, name, alias, field_type, description, config_json, show_in_stream, active, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, alias = excluded.alias, field_type = excluded.field_type,
           description = excluded.description, config_json = excluded.config_json, show_in_stream = excluded.show_in_stream,
           active = excluded.active, sort_order = excluded.sort_order`,
      ).run(field.id, field.name, field.alias ?? null, field.fieldType, field.description ?? '', JSON.stringify(field.config ?? {}),
        field.showInStream === false ? 0 : 1, field.active === false ? 0 : 1, field.sortOrder ?? 0, field.createdAt ?? now);
    }
    for (const rule of backup.rules) {
      db.prepare(
        `INSERT INTO rules (id, name, description, enabled, priority, stop_on_match, conditions_json, actions_json, hit_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, enabled = excluded.enabled,
           priority = excluded.priority, stop_on_match = excluded.stop_on_match, conditions_json = excluded.conditions_json,
           actions_json = excluded.actions_json, hit_count = excluded.hit_count, updated_at = excluded.updated_at`,
      ).run(rule.id, rule.name, rule.description ?? '', rule.enabled === false ? 0 : 1, rule.priority ?? 100,
        rule.stopOnMatch ? 1 : 0, JSON.stringify(rule.conditions), JSON.stringify(rule.actions), rule.hitCount ?? 0,
        rule.createdAt ?? now, rule.updatedAt ?? now);
    }
    for (const template of backup.extractors) {
      db.prepare(
        `INSERT INTO extractor_templates (id, name, slug, description, output_mode, preamble, item_template, footer,
           include_neighbors, exclude_noise, is_default, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, description = excluded.description,
           output_mode = excluded.output_mode, preamble = excluded.preamble, item_template = excluded.item_template,
           footer = excluded.footer, include_neighbors = excluded.include_neighbors, exclude_noise = excluded.exclude_noise,
           is_default = excluded.is_default, sort_order = excluded.sort_order`,
      ).run(template.id, template.name, template.slug, template.description ?? '', template.outputMode ?? 'clipboard',
        template.preamble ?? '', template.itemTemplate ?? '{{content}}', template.footer ?? '',
        template.includeNeighbors === false ? 0 : 1, template.excludeNoise === false ? 0 : 1, template.isDefault ? 1 : 0,
        template.sortOrder ?? 0, template.createdAt ?? now, template.updatedAt ?? now);
    }
    for (const view of backup.views) {
      db.prepare(
        `INSERT INTO saved_views (id, name, query, sort, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, query = excluded.query, sort = excluded.sort, sort_order = excluded.sort_order`,
      ).run(view.id, view.name, view.query ?? '', view.sort ?? 'recent', view.sortOrder ?? 0, view.createdAt ?? now);
    }
    const upsertCapture = db.prepare(
      `INSERT INTO captures (id, content, bucket, status, is_pinned, capture_mode, triaged, source_url, url_title,
         url_excerpt, meta, expires_at, expire_action, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET content = excluded.content, bucket = excluded.bucket, status = excluded.status,
         is_pinned = excluded.is_pinned, capture_mode = excluded.capture_mode, triaged = excluded.triaged,
         source_url = excluded.source_url, url_title = excluded.url_title, url_excerpt = excluded.url_excerpt,
         meta = excluded.meta, expires_at = excluded.expires_at, expire_action = excluded.expire_action,
         deleted_at = excluded.deleted_at, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    );
    const upsertFieldValue = db.prepare(
      `INSERT INTO capture_fields (capture_id, field_id, value_text, value_num, source, locked, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(capture_id, field_id) DO UPDATE SET value_text = excluded.value_text, value_num = excluded.value_num,
         source = excluded.source, locked = excluded.locked, updated_at = excluded.updated_at`,
    );
    for (const item of backup.captures) {
      upsertCapture.run(item.id, item.content, item.bucket, item.status, item.isPinned ? 1 : 0, item.captureMode ?? 'auto',
        item.triaged ? 1 : 0, item.sourceUrl ?? null, item.urlTitle ?? null, item.urlExcerpt ?? null,
        JSON.stringify(item.meta ?? {}), item.expiresAt ?? null, item.expireAction ?? 'archive', item.deletedAt ?? null,
        item.createdAt, item.updatedAt ?? item.createdAt);
      setCaptureTags(db, item.id, item.tags);
      for (const [name, value] of Object.entries(item.fields)) {
        const field = db.prepare('SELECT id FROM custom_fields WHERE name = ?').get(name) as { id: string } | undefined;
        if (!field) continue;
        upsertFieldValue.run(item.id, field.id, value.valueText ?? null, value.valueNum ?? null,
          value.source ?? 'human', value.locked ? 1 : 0, value.updatedAt ?? now);
      }
      if (item.reminder === null) db.prepare('DELETE FROM reminders WHERE capture_id = ?').run(item.id);
      else if (item.reminder) upsertReminder(db, item.id, {
        dueAt: item.reminder.dueAt, state: item.reminder.state ?? 'pending', snoozeCount: item.reminder.snoozeCount ?? 0,
        recurrence: item.reminder.recurrence ?? null, lastNotifiedAt: item.reminder.lastNotifiedAt ?? null,
      });
      syncCaptureFts(db, item.id);
    }
    const deleteEdge = db.prepare('DELETE FROM capture_edges WHERE source_id = ? AND target_id = ? AND relation = ?');
    for (const edge of backup.edges) {
      deleteEdge.run(edge.sourceId, edge.targetId, edge.relation);
      insertEdge(db, edge.sourceId, edge.targetId, edge.relation, edge.note ?? null);
    }
    for (const [key, value] of Object.entries(backup.settings)) {
      db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value, now);
    }
  })();
  return backup.captures.length;
}
