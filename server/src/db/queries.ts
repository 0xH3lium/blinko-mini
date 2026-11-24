import type Database from 'better-sqlite3';
import { config } from '../config.js';

export type Bucket = 'idea' | 'memory' | 'reminder' | 'question' | 'reference' | 'noise';
export type CaptureStatus = 'active' | 'resolved' | 'archived';
export type CaptureMode = 'auto' | 'manual';
export type EdgeRelation = 'reply' | 'related' | 'refines' | 'supports' | 'blocks' | 'answers';
export type FieldType = 'score' | 'choice' | 'boolean' | 'text';
export type FieldSource = 'rule' | 'syntax' | 'human' | 'patch';
export type ReminderState = 'pending' | 'notified' | 'done' | 'killed';
export type ExpireAction = 'archive' | 'trash' | 'delete';

export const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
export const CAPTURE_STATUSES: CaptureStatus[] = ['active', 'resolved', 'archived'];
export const EDGE_RELATIONS: EdgeRelation[] = ['reply', 'related', 'refines', 'supports', 'blocks', 'answers'];
export const FIELD_TYPES: FieldType[] = ['score', 'choice', 'boolean', 'text'];

export interface CustomField {
  id: string;
  name: string;
  alias: string | null;
  fieldType: FieldType;
  description: string;
  config: Record<string, unknown>;
  showInStream: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface CaptureField {
  captureId: string;
  fieldId: string;
  name: string;
  valueText: string | null;
  valueNum: number | null;
  source: FieldSource;
  locked: boolean;
  updatedAt: number;
}

export interface Reminder {
  captureId: string;
  dueAt: number;
  snoozeCount: number;
  recurrence: string | null;
  state: ReminderState;
  lastNotifiedAt: number | null;
}

export interface Capture {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  captureMode: CaptureMode;
  triaged: boolean;
  expiresAt: number | null;
  expireAction: ExpireAction;
  deletedAt: number | null;
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  tags: string[];
  fields: Record<string, CaptureField>;
  reminder: Reminder | null;
  edgeCount: number;
  createdAt: number;
  updatedAt: number;
  snippet?: string;
}

export interface CaptureRow {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  is_pinned: number;
  capture_mode: CaptureMode;
  triaged: number;
  expires_at: number | null;
  expire_action: ExpireAction;
  deleted_at: number | null;
  source_url: string | null;
  url_title: string | null;
  url_excerpt: string | null;
  meta: string;
  created_at: number;
  updated_at: number;
  snippet?: string;
}

export interface Edge {
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  note: string | null;
  createdAt: number;
  otherId: string;
  otherContent: string;
  otherBucket: Bucket;
  otherStatus: CaptureStatus;
  direction: 'outgoing' | 'incoming';
}

export interface SavedView {
  id: string;
  name: string;
  query: string;
  sort: string;
  sortOrder: number;
  createdAt: number;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExtractorTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  outputMode: 'clipboard' | 'download_md' | 'download_json' | 'obsidian_uri';
  preamble: string;
  itemTemplate: string;
  footer: string;
  includeNeighbors: boolean;
  excludeNoise: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type CaptureSort = 'relevance' | 'recent' | 'updated' | 'due' | 'length' | `field:${string}`;

export interface CaptureFilters {
  bucket?: Bucket;
  status?: CaptureStatus | 'all';
  tag?: string;
  q?: string;
  sort?: CaptureSort;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  includeTrash?: boolean;
}

export interface CapturePage {
  captures: Capture[];
  total: number;
  bucketCounts: Record<string, number>;
}

export type FieldOperator = '>=' | '<=' | '>' | '<' | ':';
export interface FieldFilter { field: string; op: FieldOperator; value: string }

export interface ParsedSearchQuery {
  buckets: { include: string[]; exclude: string[] };
  statuses: { include: string[]; exclude: string[] };
  tags: { include: string[]; exclude: string[] };
  pinned?: boolean;
  triaged?: boolean;
  trash?: boolean;
  mode?: CaptureMode;
  has: { include: string[]; exclude: string[] };
  due: string[];
  fieldFilters: FieldFilter[];
  length: Array<{ op: '<' | '>'; value: number }>;
  age: Array<{ op: '<' | '>'; ms: number }>;
  text: string;
  ftsQuery: string | null;
}

export interface AgendaItem extends Reminder {
  captureId: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  recurrence: string | null;
}

export interface Agenda {
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: AgendaItem[];
  snoozed: AgendaItem[];
}

export interface Triage {
  untriaged: Capture[];
  stubs: Capture[];
  bursts: Array<{ captures: Capture[]; spanSec: number }>;
  stale: Capture[];
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Normalize Arabic/Persian spelling variants for FTS indexing and querying. Raw capture content is never changed. */
export function normalizeSearchText(value: string): string {
  return value
    .replace(/[\u200c\u200d]/g, '')
    .replace(/ي/g, 'ی').replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک').replace(/ة/g, 'ه')
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

export function normalizeTags(tags: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeSearchText(raw.trim().replace(/^#+/, ''));
    if (/^[\p{L}\p{N}_-]{1,50}$/u.test(tag)) out.add(tag);
  }
  return [...out];
}

/** Build an FTS5 MATCH expression from plain words; user input can never inject FTS operators. */
export function ftsTermQuery(text: string): string | null {
  const words = normalizeSearchText(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length === 0) return null;
  return words.map((word) => `"${word.replaceAll('"', '""')}"*`).join(' ');
}

export function fieldFromRow(row: {
  id: string; name: string; alias: string | null; field_type: FieldType; description: string;
  config_json: string; show_in_stream: number; active: number; sort_order: number; created_at: number;
}): CustomField {
  return {
    id: row.id, name: row.name, alias: row.alias, fieldType: row.field_type, description: row.description,
    config: parseJson(row.config_json, {}), showInStream: row.show_in_stream === 1, active: row.active === 1,
    sortOrder: row.sort_order, createdAt: row.created_at,
  };
}

export function captureFromRow(
  row: CaptureRow,
  extra: Partial<Pick<Capture, 'tags' | 'fields' | 'reminder' | 'edgeCount' | 'snippet'>> = {},
): Capture {
  return {
    id: row.id,
    content: row.content,
    bucket: row.bucket,
    status: row.status,
    isPinned: row.is_pinned === 1,
    captureMode: row.capture_mode,
    triaged: row.triaged === 1,
    expiresAt: row.expires_at,
    expireAction: row.expire_action ?? 'archive',
    deletedAt: row.deleted_at,
    sourceUrl: row.source_url,
    urlTitle: row.url_title,
    urlExcerpt: row.url_excerpt,
    meta: parseJson(row.meta, {}),
    tags: extra.tags ?? [],
    fields: extra.fields ?? {},
    reminder: extra.reminder ?? null,
    edgeCount: extra.edgeCount ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(extra.snippet !== undefined ? { snippet: extra.snippet } : {}),
  };
}

export function ruleFromRow(row: {
  id: string; name: string; description: string; enabled: number; priority: number; stop_on_match: number;
  conditions_json: string; actions_json: string; hit_count: number; created_at: number; updated_at: number;
}): Rule {
  return {
    id: row.id, name: row.name, description: row.description, enabled: row.enabled === 1, priority: row.priority,
    stopOnMatch: row.stop_on_match === 1, conditions: parseJson(row.conditions_json, {}),
    actions: parseJson(row.actions_json, {}), hitCount: row.hit_count, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function templateFromRow(row: {
  id: string; name: string; slug: string; description: string; output_mode: ExtractorTemplate['outputMode'];
  preamble: string; item_template: string; footer: string; include_neighbors: number; exclude_noise: number;
  is_default: number; sort_order: number; created_at: number; updated_at: number;
}): ExtractorTemplate {
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description, outputMode: row.output_mode,
    preamble: row.preamble, itemTemplate: row.item_template, footer: row.footer,
    includeNeighbors: row.include_neighbors === 1, excludeNoise: row.exclude_noise === 1,
    isDefault: row.is_default === 1, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function getCaptureRow(db: Database.Database, id: string): CaptureRow | undefined {
  return db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as CaptureRow | undefined;
}

export function listFields(db: Database.Database, activeOnly = false): CustomField[] {
  const rows = db
    .prepare(`SELECT * FROM custom_fields ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order ASC, created_at ASC`)
    .all() as Parameters<typeof fieldFromRow>[0][];
  return rows.map(fieldFromRow);
}

export function getField(db: Database.Database, key: string): CustomField | undefined {
  const row = db.prepare('SELECT * FROM custom_fields WHERE id = ? OR name = ? OR alias = ?').get(key, key, key) as Parameters<typeof fieldFromRow>[0] | undefined;
  return row ? fieldFromRow(row) : undefined;
}

export function upsertField(db: Database.Database, input: {
  id: string; name: string; alias?: string | null; fieldType: FieldType; description?: string;
  config?: Record<string, unknown>; showInStream?: boolean; active?: boolean; sortOrder?: number;
}): CustomField {
  const now = Date.now();
  db.prepare(
    `INSERT INTO custom_fields (id, name, alias, field_type, description, config_json, show_in_stream, active, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, alias = excluded.alias, field_type = excluded.field_type,
       description = excluded.description, config_json = excluded.config_json, show_in_stream = excluded.show_in_stream,
       active = excluded.active, sort_order = excluded.sort_order`,
  ).run(input.id, input.name, input.alias ?? null, input.fieldType, input.description ?? '', JSON.stringify(input.config ?? {}),
    input.showInStream === false ? 0 : 1, input.active === false ? 0 : 1, input.sortOrder ?? 0, now);
  return getField(db, input.id)!;
}

export function deleteField(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM custom_fields WHERE id = ?').run(id).changes > 0;
}

export function listRules(db: Database.Database): Rule[] {
  const rows = db.prepare('SELECT * FROM rules ORDER BY priority ASC, created_at ASC').all() as Parameters<typeof ruleFromRow>[0][];
  return rows.map(ruleFromRow);
}

export function getRule(db: Database.Database, id: string): Rule | undefined {
  const row = db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Parameters<typeof ruleFromRow>[0] | undefined;
  return row ? ruleFromRow(row) : undefined;
}

export function upsertRule(db: Database.Database, input: {
  id: string; name: string; description?: string; enabled?: boolean; priority?: number; stopOnMatch?: boolean;
  conditions: Record<string, unknown>; actions: Record<string, unknown>;
}): Rule {
  const now = Date.now();
  db.prepare(
    `INSERT INTO rules (id, name, description, enabled, priority, stop_on_match, conditions_json, actions_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, enabled = excluded.enabled,
       priority = excluded.priority, stop_on_match = excluded.stop_on_match, conditions_json = excluded.conditions_json,
       actions_json = excluded.actions_json, updated_at = excluded.updated_at`,
  ).run(input.id, input.name, input.description ?? '', input.enabled === false ? 0 : 1, input.priority ?? 100,
    input.stopOnMatch ? 1 : 0, JSON.stringify(input.conditions), JSON.stringify(input.actions), now, now);
  return getRule(db, input.id)!;
}

export function deleteRule(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes > 0;
}

export function listTemplates(db: Database.Database): ExtractorTemplate[] {
  const rows = db.prepare('SELECT * FROM extractor_templates ORDER BY sort_order ASC, created_at ASC').all() as Parameters<typeof templateFromRow>[0][];
  return rows.map(templateFromRow);
}

export function getTemplate(db: Database.Database, key: string): ExtractorTemplate | undefined {
  const row = db.prepare('SELECT * FROM extractor_templates WHERE id = ? OR slug = ?').get(key, key) as Parameters<typeof templateFromRow>[0] | undefined;
  return row ? templateFromRow(row) : undefined;
}

export function getDefaultTemplate(db: Database.Database): ExtractorTemplate | undefined {
  const row = db.prepare('SELECT * FROM extractor_templates WHERE is_default = 1 ORDER BY sort_order ASC LIMIT 1').get() as Parameters<typeof templateFromRow>[0] | undefined;
  return row ? templateFromRow(row) : listTemplates(db)[0];
}

export function upsertTemplate(db: Database.Database, input: {
  id: string; name: string; slug: string; description?: string; outputMode?: ExtractorTemplate['outputMode'];
  preamble?: string; itemTemplate?: string; footer?: string; includeNeighbors?: boolean; excludeNoise?: boolean;
  isDefault?: boolean; sortOrder?: number;
}): ExtractorTemplate {
  const now = Date.now();
  db.prepare(
    `INSERT INTO extractor_templates
       (id, name, slug, description, output_mode, preamble, item_template, footer, include_neighbors,
        exclude_noise, is_default, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, description = excluded.description,
       output_mode = excluded.output_mode, preamble = excluded.preamble, item_template = excluded.item_template,
       footer = excluded.footer, include_neighbors = excluded.include_neighbors, exclude_noise = excluded.exclude_noise,
       is_default = excluded.is_default, sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
  ).run(input.id, input.name, input.slug, input.description ?? '', input.outputMode ?? 'clipboard', input.preamble ?? '',
    input.itemTemplate ?? '{{content}}', input.footer ?? '', input.includeNeighbors === false ? 0 : 1,
    input.excludeNoise === false ? 0 : 1, input.isDefault ? 1 : 0, input.sortOrder ?? 0, now, now);
  if (input.isDefault) db.prepare('UPDATE extractor_templates SET is_default = 0 WHERE id <> ?').run(input.id);
  return getTemplate(db, input.id)!;
}

export function deleteTemplate(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM extractor_templates WHERE id = ?').run(id).changes > 0;
}

function tagsForCaptures(db: Database.Database, ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT ct.capture_id, t.name FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.capture_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE ASC`,
  ).all(...ids) as Array<{ capture_id: string; name: string }>;
  for (const row of rows) map.set(row.capture_id, [...(map.get(row.capture_id) ?? []), row.name]);
  return map;
}

function fieldsForCaptures(db: Database.Database, ids: string[]): Map<string, Record<string, CaptureField>> {
  const map = new Map<string, Record<string, CaptureField>>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT cf.*, f.name FROM capture_fields cf JOIN custom_fields f ON f.id = cf.field_id
     WHERE cf.capture_id IN (${placeholders}) ORDER BY f.sort_order ASC`,
  ).all(...ids) as Array<{
    capture_id: string; field_id: string; name: string; value_text: string | null; value_num: number | null;
    source: FieldSource; locked: number; updated_at: number;
  }>;
  for (const row of rows) {
    const fields = map.get(row.capture_id) ?? {};
    fields[row.name] = {
      captureId: row.capture_id, fieldId: row.field_id, name: row.name, valueText: row.value_text,
      valueNum: row.value_num, source: row.source, locked: row.locked === 1, updatedAt: row.updated_at,
    };
    map.set(row.capture_id, fields);
  }
  return map;
}

function remindersForCaptures(db: Database.Database, ids: string[]): Map<string, Reminder> {
  const map = new Map<string, Reminder>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT * FROM reminders WHERE capture_id IN (${placeholders})`).all(...ids) as Array<{
    capture_id: string; due_at: number; snooze_count: number; recurrence: string | null;
    state: ReminderState; last_notified_at: number | null;
  }>;
  for (const row of rows) {
    map.set(row.capture_id, {
      captureId: row.capture_id, dueAt: row.due_at, snoozeCount: row.snooze_count, recurrence: row.recurrence,
      state: row.state, lastNotifiedAt: row.last_notified_at,
    });
  }
  return map;
}

function edgeCountsForCaptures(db: Database.Database, ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT id, (SELECT COUNT(*) FROM capture_edges e WHERE e.source_id = c.id OR e.target_id = c.id) AS count
     FROM captures c WHERE c.id IN (${placeholders})`,
  ).all(...ids) as Array<{ id: string; count: number }>;
  for (const row of rows) map.set(row.id, Number(row.count));
  return map;
}

export function hydrateCaptures(db: Database.Database, rows: CaptureRow[], snippets: Map<string, string> = new Map()): Capture[] {
  const ids = rows.map((row) => row.id);
  const tags = tagsForCaptures(db, ids);
  const fields = fieldsForCaptures(db, ids);
  const reminders = remindersForCaptures(db, ids);
  const edgeCounts = edgeCountsForCaptures(db, ids);
  return rows.map((row) => captureFromRow(row, {
    tags: tags.get(row.id) ?? [], fields: fields.get(row.id) ?? {}, reminder: reminders.get(row.id) ?? null,
    edgeCount: edgeCounts.get(row.id) ?? 0, snippet: snippets.get(row.id),
  }));
}

export function getCapture(db: Database.Database, id: string): Capture | undefined {
  const row = getCaptureRow(db, id);
  return row ? hydrateCaptures(db, [row])[0] : undefined;
}

export function getCaptureDetail(db: Database.Database, id: string): (Capture & { edges: Edge[] }) | undefined {
  const capture = getCapture(db, id);
  return capture ? { ...capture, edges: listEdgesForCapture(db, id) } : undefined;
}

export function getFieldsForCapture(db: Database.Database, captureId: string): Record<string, CaptureField> {
  return fieldsForCaptures(db, [captureId]).get(captureId) ?? {};
}

export interface UpsertFieldValueInput {
  valueText?: string | null;
  valueNum?: number | null;
  source: FieldSource;
  locked?: boolean;
}

export function upsertFieldValue(db: Database.Database, captureId: string, fieldId: string, input: UpsertFieldValueInput): void {
  db.prepare(
    `INSERT INTO capture_fields (capture_id, field_id, value_text, value_num, source, locked, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id, field_id) DO UPDATE SET value_text = excluded.value_text, value_num = excluded.value_num,
       source = excluded.source, locked = CASE WHEN excluded.locked = 1 THEN 1 ELSE capture_fields.locked END,
       updated_at = excluded.updated_at`,
  ).run(captureId, fieldId, input.valueText ?? null, input.valueNum ?? null, input.source, input.locked ? 1 : 0, Date.now());
}

export function deleteFieldValue(db: Database.Database, captureId: string, fieldId: string): void {
  db.prepare('DELETE FROM capture_fields WHERE capture_id = ? AND field_id = ?').run(captureId, fieldId);
}

export function setCaptureTags(db: Database.Database, id: string, tags: readonly string[]): void {
  db.prepare('DELETE FROM capture_tags WHERE capture_id = ?').run(id);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)');
  for (const tag of normalizeTags(tags)) {
    insertTag.run(tag);
    const row = findTag.get(tag) as { id: number } | undefined;
    if (row) link.run(id, row.id);
  }
}

export function deleteOrphanTags(db: Database.Database): void {
  db.prepare('DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM capture_tags ct WHERE ct.tag_id = tags.id)').run();
}

export function syncCaptureFts(db: Database.Database, captureId: string): void {
  deleteCaptureFts(db, captureId);
  const row = db.prepare(
    `SELECT c.content, c.url_title, c.url_excerpt,
            COALESCE(GROUP_CONCAT(t.name, ' '), '') AS tags_text
     FROM captures c
     LEFT JOIN capture_tags ct ON ct.capture_id = c.id
     LEFT JOIN tags t ON t.id = ct.tag_id
     WHERE c.id = ? GROUP BY c.id`,
  ).get(captureId) as { content: string; tags_text: string; url_title: string | null; url_excerpt: string | null } | undefined;
  if (!row) return;
  db.prepare('INSERT INTO captures_fts (capture_id, content, tags_text, url_title, url_excerpt) VALUES (?, ?, ?, ?, ?)')
    .run(captureId, normalizeSearchText(row.content), normalizeSearchText(row.tags_text),
      normalizeSearchText(row.url_title ?? ''), normalizeSearchText(row.url_excerpt ?? ''));
}

export function deleteCaptureFts(db: Database.Database, captureId: string): void {
  db.prepare('DELETE FROM captures_fts WHERE capture_id = ?').run(captureId);
}

export function rebuildFts(db: Database.Database): number {
  db.exec('DELETE FROM captures_fts');
  const ids = db.prepare('SELECT id FROM captures').all() as Array<{ id: string }>;
  for (const row of ids) syncCaptureFts(db, row.id);
  return ids.length;
}

export function listTags(db: Database.Database, includeDeleted = false): Array<{ name: string; count: number }> {
  return db.prepare(
    `SELECT t.name, COUNT(DISTINCT c.id) AS count FROM tags t
     JOIN capture_tags ct ON ct.tag_id = t.id JOIN captures c ON c.id = ct.capture_id
     WHERE ? = 1 OR c.deleted_at IS NULL
     GROUP BY t.id, t.name ORDER BY count DESC, t.name ASC`,
  ).all(includeDeleted ? 1 : 0) as Array<{ name: string; count: number }>;
}

export function bucketCounts(db: Database.Database, status?: CaptureStatus): Record<string, number> {
  const rows = status
    ? db.prepare('SELECT bucket, COUNT(*) AS count FROM captures WHERE status = ? AND deleted_at IS NULL GROUP BY bucket').all(status) as Array<{ bucket: string; count: number }>
    : db.prepare('SELECT bucket, COUNT(*) AS count FROM captures WHERE deleted_at IS NULL GROUP BY bucket').all() as Array<{ bucket: string; count: number }>;
  const counts: Record<string, number> = { all: 0 };
  for (const bucket of BUCKETS) counts[bucket] = 0;
  for (const row of rows) {
    counts[row.bucket] = Number(row.count);
    counts.all = (counts.all ?? 0) + Number(row.count);
  }
  return counts;
}

const SPECIAL_TOKEN = /(-?)(bucket|b|status|mode|has|due|is):([^\s#]+)|(-?)#([^\s#]+)/giu;
const FIELD_TOKEN = /(-?)([\p{L}][\p{L}\p{N}_]*)(>=|<=|>|<|:)([^\s]+)/gu;
const RESERVED_NAMES = new Set(['bucket', 'b', 'status', 'mode', 'has', 'due', 'is', 'sort', 'order', 'limit', 'http', 'https']);

export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = {
    buckets: { include: [], exclude: [] }, statuses: { include: [], exclude: [] },
    tags: { include: [], exclude: [] }, has: { include: [], exclude: [] }, due: [],
    fieldFilters: [], length: [], age: [], text: '', ftsQuery: null,
  };

  let remaining = rawQuery.trim();
  remaining = remaining.replace(SPECIAL_TOKEN, (_match, negA: string | undefined, keyA: string | undefined, valueA: string | undefined, negB: string | undefined, tag: string | undefined) => {
    const neg = negA === '-' || negB === '-';
    const key = keyA?.toLowerCase();
    const value = normalizeSearchText(valueA ?? tag ?? '');
    if (key) {
      if (key === 'b' || key === 'bucket') parsed.buckets[neg ? 'exclude' : 'include'].push(value);
      else if (key === 'status') parsed.statuses[neg ? 'exclude' : 'include'].push(value);
      else if (key === 'mode' && (value === 'auto' || value === 'manual')) parsed.mode = value;
      else if (key === 'is' && value === 'pinned') parsed.pinned = !neg;
      else if (key === 'is' && value === 'triaged') parsed.triaged = !neg;
      else if (key === 'is' && value === 'trash') parsed.trash = !neg;
      else if (key === 'has') parsed.has[neg ? 'exclude' : 'include'].push(value);
      else if (key === 'due') parsed.due.push(value);
    } else if (tag) parsed.tags[neg ? 'exclude' : 'include'].push(value);
    return ' ';
  });

  remaining = remaining.replace(FIELD_TOKEN, (_match, neg: string | undefined, rawName: string, op: FieldOperator, rawValue: string) => {
    const name = rawName.toLowerCase();
    if (RESERVED_NAMES.has(name) || rawValue.startsWith('//')) return ' ';
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (name === 'len' && (op === '<' || op === '>') && Number.isFinite(Number(value))) {
      parsed.length.push({ op, value: Number(value) });
    } else if (name === 'age' && (op === '<' || op === '>')) {
      const match = /^(\d+)([hdw])$/i.exec(value);
      if (match) parsed.age.push({ op, ms: Number(match[1]) * ({ h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]!.toLowerCase() as 'h' | 'd' | 'w']) });
    } else {
      parsed.fieldFilters.push({ field: name, op, value: neg === '-' ? `!${value}` : value });
    }
    return ' ';
  });

  const words: string[] = [];
  for (const token of remaining.match(/"[^"]+"|\S+/gu) ?? []) {
    const cleaned = token.replace(/^["']+|["']+$/g, '').replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim();
    if (cleaned) words.push(cleaned);
  }
  parsed.text = words.join(' ');
  parsed.ftsQuery = ftsTermQuery(parsed.text);
  return parsed;
}

function ownerDayStart(now: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: config.OWNER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(now));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const zonedUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
    const offset = zonedUtc - Math.floor(now / 1000) * 1000;
    return Date.UTC(value('year'), value('month') - 1, value('day')) - offset;
  } catch {
    const date = new Date(now);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }
}

interface Filters {
  joins: string[];
  joinParams: unknown[];
  where: string[];
  whereParams: unknown[];
  ftsActive: boolean;
  includeTrash: boolean;
}

function buildFilters(filters: CaptureFilters, parsed: ParsedSearchQuery, now: number): Filters {
  const result: Filters = { joins: [], joinParams: [], where: [], whereParams: [], ftsActive: false, includeTrash: filters.includeTrash === true };
  const { where, whereParams, joins, joinParams } = result;

  if (parsed.trash || result.includeTrash) {
    result.includeTrash = true;
    if (parsed.trash) where.push('c.deleted_at IS NOT NULL');
  } else where.push('c.deleted_at IS NULL');

  if (filters.bucket) { where.push('c.bucket = ?'); whereParams.push(filters.bucket); }
  if (filters.status && filters.status !== 'all') { where.push('c.status = ?'); whereParams.push(filters.status); }
  if (filters.tag) {
    where.push(`EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id AND t.name = ?)`);
    whereParams.push(normalizeTags([filters.tag])[0] ?? filters.tag);
  }
  const inClause = (values: string[]) => values.map(() => '?').join(', ');
  if (parsed.buckets.include.length) { where.push(`c.bucket IN (${inClause(parsed.buckets.include)})`); whereParams.push(...parsed.buckets.include); }
  if (parsed.buckets.exclude.length) { where.push(`c.bucket NOT IN (${inClause(parsed.buckets.exclude)})`); whereParams.push(...parsed.buckets.exclude); }
  if (parsed.statuses.include.length && !parsed.statuses.include.includes('all')) { where.push(`c.status IN (${inClause(parsed.statuses.include)})`); whereParams.push(...parsed.statuses.include); }
  if (parsed.statuses.exclude.length && !parsed.statuses.exclude.includes('all')) { where.push(`c.status NOT IN (${inClause(parsed.statuses.exclude)})`); whereParams.push(...parsed.statuses.exclude); }
  for (const tag of parsed.tags.include) {
    where.push(`EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id AND t.name = ?)`);
    whereParams.push(tag);
  }
  for (const tag of parsed.tags.exclude) {
    where.push(`NOT EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id AND t.name = ?)`);
    whereParams.push(tag);
  }
  if (parsed.pinned !== undefined) { where.push('c.is_pinned = ?'); whereParams.push(parsed.pinned ? 1 : 0); }
  if (parsed.triaged !== undefined) { where.push('c.triaged = ?'); whereParams.push(parsed.triaged ? 1 : 0); }
  if (parsed.mode) { where.push('c.capture_mode = ?'); whereParams.push(parsed.mode); }

  for (const has of parsed.has.include) {
    if (has === 'url') where.push("c.source_url IS NOT NULL AND c.source_url <> ''");
    else if (has === 'due') where.push('EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id)');
    else if (has === 'links') where.push('EXISTS (SELECT 1 FROM capture_edges e WHERE e.source_id = c.id OR e.target_id = c.id)');
    else if (has === 'ttl') where.push('c.expires_at IS NOT NULL');
    else if (has === 'fields') where.push('EXISTS (SELECT 1 FROM capture_fields cf WHERE cf.capture_id = c.id)');
    else if (has === 'tags') where.push('EXISTS (SELECT 1 FROM capture_tags ct WHERE ct.capture_id = c.id)');
    else {
      where.push(`EXISTS (SELECT 1 FROM capture_fields cf JOIN custom_fields f ON f.id = cf.field_id
                     WHERE cf.capture_id = c.id AND (f.name = ? OR f.alias = ?))`);
      whereParams.push(has, has);
    }
  }
  for (const has of parsed.has.exclude) {
    if (has === 'url') where.push("(c.source_url IS NULL OR c.source_url = '')");
    else if (has === 'due') where.push('NOT EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id)');
    else if (has === 'links') where.push('NOT EXISTS (SELECT 1 FROM capture_edges e WHERE e.source_id = c.id OR e.target_id = c.id)');
    else if (has === 'ttl') where.push('c.expires_at IS NULL');
    else if (has === 'fields') where.push('NOT EXISTS (SELECT 1 FROM capture_fields cf WHERE cf.capture_id = c.id)');
    else if (has === 'tags') where.push('NOT EXISTS (SELECT 1 FROM capture_tags ct WHERE ct.capture_id = c.id)');
    else {
      where.push(`NOT EXISTS (SELECT 1 FROM capture_fields cf JOIN custom_fields f ON f.id = cf.field_id
                      WHERE cf.capture_id = c.id AND (f.name = ? OR f.alias = ?))`);
      whereParams.push(has, has);
    }
  }

  const dayStart = ownerDayStart(now);
  for (const due of parsed.due) {
    if (due === 'overdue') {
      where.push("EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id AND r.state IN ('pending','notified') AND r.due_at < ?)");
      whereParams.push(now);
    } else if (due === 'today') {
      where.push('EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id AND r.due_at >= ? AND r.due_at < ?)');
      whereParams.push(dayStart, dayStart + 86_400_000);
    } else if (due === 'week') {
      where.push('EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id AND r.due_at >= ? AND r.due_at < ?)');
      whereParams.push(now, now + 7 * 86_400_000);
    } else where.push('0 = 1');
  }

  for (const { op, value } of parsed.length) {
    where.push(`LENGTH(c.content) ${op} ?`);
    whereParams.push(value);
  }
  for (const { op, ms } of parsed.age) {
    where.push(`c.created_at ${op === '<' ? '>' : '<'} ?`);
    whereParams.push(now - ms);
  }

  for (const filter of parsed.fieldFilters) {
    const numeric = Number(filter.value);
    const negated = filter.value.startsWith('!');
    const value = negated ? filter.value.slice(1) : filter.value;
    if (filter.op !== ':' && Number.isFinite(numeric) && !negated) {
      where.push(`EXISTS (SELECT 1 FROM capture_fields cf JOIN custom_fields f ON f.id = cf.field_id
                   WHERE cf.capture_id = c.id AND (f.name = ? OR f.alias = ?) AND cf.value_num ${filter.op} ?)`);
      whereParams.push(filter.field, filter.field, numeric);
    } else {
      where.push(`EXISTS (SELECT 1 FROM capture_fields cf JOIN custom_fields f ON f.id = cf.field_id
                   WHERE cf.capture_id = c.id AND (f.name = ? OR f.alias = ?)
                     AND LOWER(COALESCE(cf.value_text, '')) ${negated ? '!=' : '='} LOWER(?))`);
      whereParams.push(filter.field, filter.field, value);
    }
  }

  if (parsed.ftsQuery) {
    joins.push('JOIN captures_fts fts ON fts.capture_id = c.id');
    where.push('captures_fts MATCH ?');
    whereParams.push(parsed.ftsQuery);
    result.ftsActive = true;
  }
  return result;
}

function orderByFor(filters: CaptureFilters, ftsActive: boolean): { sql: string; joins: string[]; params: unknown[] } {
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const sort = filters.sort ?? (ftsActive ? 'relevance' : 'recent');
  const joins: string[] = [];
  const params: unknown[] = [];
  if (sort === 'relevance' && ftsActive) return { sql: `bm25(captures_fts, 10.0, 6.0, 5.0, 2.0) ASC, c.created_at DESC`, joins, params };
  if (sort === 'updated') return { sql: `c.updated_at ${direction}, c.rowid ${direction}`, joins, params };
  if (sort === 'length') return { sql: `LENGTH(c.content) ${direction}, c.created_at DESC`, joins, params };
  if (sort === 'due') {
    joins.push('LEFT JOIN reminders sort_r ON sort_r.capture_id = c.id');
    return { sql: `sort_r.due_at IS NULL, sort_r.due_at ${direction}, c.created_at ${direction}`, joins, params };
  }
  if (sort.startsWith('field:')) {
    const name = sort.slice('field:'.length);
    joins.push('LEFT JOIN custom_fields sort_f ON sort_f.name = ? OR sort_f.alias = ?');
    params.push(name, name);
    joins.push('LEFT JOIN capture_fields sort_cf ON sort_cf.capture_id = c.id AND sort_cf.field_id = sort_f.id');
    return { sql: `sort_cf.value_num ${direction}, sort_cf.value_text ${direction}, c.created_at ${direction}`, joins, params };
  }
  return { sql: `c.is_pinned DESC, c.created_at ${direction}, c.rowid ${direction}`, joins, params };
}

export function listCaptures(db: Database.Database, filters: CaptureFilters = {}): CapturePage {
  const now = Date.now();
  const parsed = parseSearchQuery(filters.q ?? '');
  const filtered = buildFilters(filters, parsed, now);
  const where = filtered.where.length > 0 ? filtered.where.join(' AND ') : '1 = 1';
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM captures c ${filtered.joins.join(' ')} WHERE ${where}`)
    .get(...filtered.joinParams, ...filtered.whereParams) as { count: number };

  const order = orderByFor(filters, filtered.ftsActive);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 5000);
  const offset = Math.max(filters.offset ?? 0, 0);
  const snippetSelect = filtered.ftsActive
    ? ", snippet(captures_fts, 1, '<mark>', '</mark>', '…', 24) AS snippet"
    : '';
  const rows = db.prepare(
    `SELECT c.*${snippetSelect} FROM captures c ${filtered.joins.join(' ')} ${order.joins.join(' ')}
     WHERE ${where} ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
  ).all(...filtered.joinParams, ...order.params, ...filtered.whereParams, limit, offset) as CaptureRow[];
  const snippets = new Map<string, string>();
  if (filtered.ftsActive) {
    for (const row of rows) if (row.snippet) snippets.set(row.id, row.snippet);
  }
  return {
    captures: hydrateCaptures(db, rows, snippets), total: Number(countRow.count),
    bucketCounts: bucketCounts(db, filters.status === 'all' ? undefined : filters.status),
  };
}

export function getTriage(db: Database.Database): Triage {
  const settings = getSettings(db);
  const stubMax = Number(settings.stub_max_chars ?? 20);
  const staleMs = Number(settings.stale_days ?? 14) * 86_400_000;
  const burstSec = Number(settings.burst_window_sec ?? 180);
  const now = Date.now();
  const base = `FROM captures c WHERE c.deleted_at IS NULL`;
  const untriaged = hydrateCaptures(db, db.prepare(`SELECT c.* ${base} AND c.triaged = 0 AND c.status = 'active' ORDER BY c.created_at DESC LIMIT 300`).all() as CaptureRow[]);
  const stubs = hydrateCaptures(db, db.prepare(`SELECT c.* ${base} AND LENGTH(c.content) <= ? AND c.status = 'active' ORDER BY c.created_at DESC LIMIT 300`).all(stubMax) as CaptureRow[]);
  const stale = hydrateCaptures(db, db.prepare(`SELECT c.* ${base} AND c.status = 'active' AND c.updated_at <= ? ORDER BY c.updated_at ASC LIMIT 300`).all(now - staleMs) as CaptureRow[]);

  const recent = hydrateCaptures(db, db.prepare(`SELECT c.* ${base} AND c.status = 'active' ORDER BY c.created_at ASC LIMIT 400`).all() as CaptureRow[]);
  const bursts: Triage['bursts'] = [];
  let group: Capture[] = [];
  for (const capture of recent) {
    const previous = group.at(-1);
    if (previous && capture.createdAt - previous.createdAt > burstSec * 1000) {
      if (group.length > 1) bursts.push({ captures: group, spanSec: Math.round((group.at(-1)!.createdAt - group[0]!.createdAt) / 1000) });
      group = [];
    }
    group.push(capture);
  }
  if (group.length > 1) bursts.push({ captures: group, spanSec: Math.round((group.at(-1)!.createdAt - group[0]!.createdAt) / 1000) });
  return { untriaged, stubs, bursts: bursts.reverse(), stale };
}

export function getReminder(db: Database.Database, captureId: string): Reminder | undefined {
  return remindersForCaptures(db, [captureId]).get(captureId);
}

export interface UpsertReminderInput {
  dueAt: number;
  recurrence?: string | null;
  state?: ReminderState;
  snoozeCount?: number;
  lastNotifiedAt?: number | null;
  keepRecurrence?: boolean;
}

export function upsertReminder(db: Database.Database, captureId: string, input: UpsertReminderInput): void {
  const existing = getReminder(db, captureId);
  db.prepare(
    `INSERT INTO reminders (capture_id, due_at, recurrence, state, snooze_count, last_notified_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET due_at = excluded.due_at, recurrence = excluded.recurrence,
       state = excluded.state, snooze_count = excluded.snooze_count, last_notified_at = excluded.last_notified_at`,
  ).run(captureId, input.dueAt, input.recurrence === undefined ? (input.keepRecurrence ? existing?.recurrence ?? null : null) : input.recurrence,
    input.state ?? 'pending', input.snoozeCount ?? 0, input.lastNotifiedAt ?? null);
}

export function listDueReminders(db: Database.Database, now: number): Reminder[] {
  const rows = db.prepare(`SELECT * FROM reminders WHERE state = 'pending' AND due_at <= ? ORDER BY due_at ASC`).all(now) as Array<{
    capture_id: string; due_at: number; snooze_count: number; recurrence: string | null; state: ReminderState; last_notified_at: number | null;
  }>;
  return rows.map((row) => ({
    captureId: row.capture_id, dueAt: row.due_at, snoozeCount: row.snooze_count, recurrence: row.recurrence,
    state: row.state, lastNotifiedAt: row.last_notified_at,
  }));
}

export function listReminders(db: Database.Database): Reminder[] {
  const rows = db.prepare(`SELECT * FROM reminders WHERE state IN ('pending','notified') ORDER BY due_at ASC`).all() as Array<{
    capture_id: string; due_at: number; snooze_count: number; recurrence: string | null; state: ReminderState; last_notified_at: number | null;
  }>;
  return rows.map((row) => ({
    captureId: row.capture_id, dueAt: row.due_at, snoozeCount: row.snooze_count, recurrence: row.recurrence,
    state: row.state, lastNotifiedAt: row.last_notified_at,
  }));
}

export function getAgenda(db: Database.Database, now = Date.now()): Agenda {
  const dayStart = ownerDayStart(now);
  const rows = db.prepare(
    `SELECT r.*, c.content, c.bucket, c.status, c.is_pinned FROM reminders r
     JOIN captures c ON c.id = r.capture_id WHERE c.deleted_at IS NULL AND r.state IN ('pending','notified') ORDER BY r.due_at ASC`,
  ).all() as Array<{
    capture_id: string; due_at: number; snooze_count: number; recurrence: string | null; state: ReminderState;
    last_notified_at: number | null; content: string; bucket: Bucket; status: CaptureStatus; is_pinned: number;
  }>;
  const agenda: Agenda = { overdue: [], today: [], upcoming: [], snoozed: [] };
  for (const row of rows) {
    const item: AgendaItem = {
      captureId: row.capture_id, dueAt: row.due_at, snoozeCount: row.snooze_count, recurrence: row.recurrence,
      state: row.state, lastNotifiedAt: row.last_notified_at, content: row.content, bucket: row.bucket,
      status: row.status, isPinned: row.is_pinned === 1,
    };
    if (item.snoozeCount >= 3) agenda.snoozed.push(item);
    if (item.dueAt < now) agenda.overdue.push(item);
    else if (item.dueAt < dayStart + 86_400_000) agenda.today.push(item);
    else agenda.upcoming.push(item);
  }
  return agenda;
}

export function listSavedViews(db: Database.Database): SavedView[] {
  const rows = db.prepare('SELECT * FROM saved_views ORDER BY sort_order ASC, created_at ASC').all() as Array<{
    id: string; name: string; query: string; sort: string; sort_order: number; created_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id, name: row.name, query: row.query, sort: row.sort, sortOrder: row.sort_order, createdAt: row.created_at,
  }));
}

export function createSavedView(db: Database.Database, input: { id: string; name: string; query: string; sort?: string; sortOrder?: number }): SavedView {
  const now = Date.now();
  db.prepare('INSERT INTO saved_views (id, name, query, sort, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.id, input.name, input.query, input.sort ?? 'recent', input.sortOrder ?? 0, now);
  return { id: input.id, name: input.name, query: input.query, sort: input.sort ?? 'recent', sortOrder: input.sortOrder ?? 0, createdAt: now };
}

export function updateSavedView(db: Database.Database, id: string, patch: Partial<Pick<SavedView, 'name' | 'query' | 'sort' | 'sortOrder'>>): SavedView | undefined {
  const current = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as {
    id: string; name: string; query: string; sort: string; sort_order: number; created_at: number;
  } | undefined;
  if (!current) return undefined;
  const name = patch.name ?? current.name;
  const query = patch.query ?? current.query;
  const sort = patch.sort ?? current.sort;
  const sortOrder = patch.sortOrder ?? current.sort_order;
  db.prepare('UPDATE saved_views SET name = ?, query = ?, sort = ?, sort_order = ? WHERE id = ?').run(name, query, sort, sortOrder, id);
  return { id, name, query, sort, sortOrder, createdAt: current.created_at };
}

export function deleteSavedView(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM saved_views WHERE id = ?').run(id).changes > 0;
}

export function getSettings(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function getSetting(db: Database.Database, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, value, Date.now());
}

export function insertEdge(db: Database.Database, sourceId: string, targetId: string, relation: EdgeRelation, note: string | null = null): void {
  if (sourceId === targetId) return;
  db.prepare(
    `INSERT INTO capture_edges (source_id, target_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_id, target_id, relation) DO UPDATE SET note = excluded.note`,
  ).run(sourceId, targetId, relation, note, Date.now());
}

export function deleteEdge(db: Database.Database, sourceId: string, targetId: string, relation: EdgeRelation): void {
  db.prepare('DELETE FROM capture_edges WHERE source_id = ? AND target_id = ? AND relation = ?').run(sourceId, targetId, relation);
}

export function listEdgesForCapture(db: Database.Database, captureId: string): Edge[] {
  const rows = db.prepare(
    `SELECT e.*,
            CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END AS other_id,
            c.content AS other_content, c.bucket AS other_bucket, c.status AS other_status,
            CASE WHEN e.source_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
     FROM capture_edges e JOIN captures c ON c.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
     WHERE e.source_id = ? OR e.target_id = ? ORDER BY e.created_at DESC`,
  ).all(captureId, captureId, captureId, captureId, captureId) as Array<{
    source_id: string; target_id: string; relation: EdgeRelation; note: string | null; created_at: number;
    other_id: string; other_content: string; other_bucket: Bucket; other_status: CaptureStatus; direction: 'outgoing' | 'incoming';
  }>;
  return rows.map((row) => ({
    sourceId: row.source_id, targetId: row.target_id, relation: row.relation, note: row.note, createdAt: row.created_at,
    otherId: row.other_id, otherContent: row.other_content, otherBucket: row.other_bucket,
    otherStatus: row.other_status, direction: row.direction,
  }));
}
