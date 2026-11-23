import type Database from 'better-sqlite3';
import { config } from '../config.js';

export type Bucket = 'idea' | 'memory' | 'reminder' | 'question' | 'reference' | 'noise';
export type CaptureStatus = 'active' | 'resolved' | 'archived';
export type CaptureMode = 'auto' | 'manual';
export type EdgeRelation = 'reply' | 'related' | 'refines' | 'supports' | 'blocks' | 'answers';
export type Primitive = 'choice' | 'score' | 'noul';
export type DecisionSource = 'deterministic' | 'jev' | 'human';
export type ReminderState = 'pending' | 'notified' | 'done' | 'killed';

export const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
export const CAPTURE_STATUSES: CaptureStatus[] = ['active', 'resolved', 'archived'];
export const EDGE_RELATIONS: EdgeRelation[] = ['reply', 'related', 'refines', 'supports', 'blocks', 'answers'];

export interface Decision {
  captureId: string;
  headId: string;
  headName: string;
  primitive: Primitive;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  source: DecisionSource;
  modelVersion: string | null;
  latencyMs: number;
  updatedAt: number;
}

export interface Reminder {
  captureId: string;
  dueAt: number;
  snoozeCount: number;
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
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  tags: string[];
  decisions: Record<string, Decision>;
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
  source_url: string | null;
  url_title: string | null;
  url_excerpt: string | null;
  meta: string;
  created_at: number;
  updated_at: number;
}

export interface Head {
  id: string;
  name: string;
  primitive: Primitive;
  instructions: string;
  config: Record<string, unknown>;
  entropyThreshold: number;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface HeadRow {
  id: string;
  name: string;
  primitive: Primitive;
  instructions: string;
  config_json: string;
  entropy_threshold: number;
  active: number;
  is_system: number;
  sort_order: number;
  created_at: number;
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

export type CaptureSort = 'recent' | 'updated' | 'due' | 'entropy' | `head:${string}`;

export interface CaptureFilters {
  bucket?: Bucket;
  status?: CaptureStatus | 'all';
  tag?: string;
  q?: string;
  sort?: CaptureSort;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CapturePage {
  captures: Capture[];
  total: number;
  bucketCounts: Record<string, number>;
}

export type HeadOperator = '>=' | '<=' | '>' | '<' | ':';

export interface HeadFilter {
  head: string;
  op: HeadOperator;
  value: string;
}

export interface ParsedSearchQuery {
  buckets: { include: string[]; exclude: string[] };
  statuses: { include: string[]; exclude: string[] };
  tags: { include: string[]; exclude: string[] };
  pinned?: boolean;
  mode?: CaptureMode;
  has: { include: string[]; exclude: string[] };
  due: string[];
  headFilters: HeadFilter[];
  text: string;
  ftsQuery: string | null;
}

export interface AgendaItem extends Reminder {
  captureId: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
}

export interface Agenda {
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: AgendaItem[];
  snoozed: AgendaItem[];
}

export interface ReviewCapture extends Capture {
  reviewDecisions: Decision[];
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

export function normalizeTags(tags: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, '').toLowerCase();
    if (/^[a-z0-9_-]{1,50}$/.test(tag)) out.add(tag);
  }
  return [...out];
}

export function headFromRow(row: HeadRow): Head {
  return {
    id: row.id,
    name: row.name,
    primitive: row.primitive,
    instructions: row.instructions,
    config: parseJson(row.config_json, {}),
    entropyThreshold: row.entropy_threshold,
    active: row.active === 1,
    isSystem: row.is_system === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function captureFromRow(
  row: CaptureRow,
  extra: Partial<Pick<Capture, 'tags' | 'decisions' | 'reminder' | 'edgeCount' | 'snippet'>> = {},
): Capture {
  return {
    id: row.id,
    content: row.content,
    bucket: row.bucket,
    status: row.status,
    isPinned: row.is_pinned === 1,
    captureMode: row.capture_mode,
    sourceUrl: row.source_url,
    urlTitle: row.url_title,
    urlExcerpt: row.url_excerpt,
    meta: parseJson(row.meta, {}),
    tags: extra.tags ?? [],
    decisions: extra.decisions ?? {},
    reminder: extra.reminder ?? null,
    edgeCount: extra.edgeCount ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(extra.snippet !== undefined ? { snippet: extra.snippet } : {}),
  };
}

export function getCaptureRow(db: Database.Database, id: string): CaptureRow | undefined {
  return db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as CaptureRow | undefined;
}

function tagsForCaptures(db: Database.Database, ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT ct.capture_id, t.name FROM capture_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.capture_id IN (${placeholders})
       ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(...ids) as Array<{ capture_id: string; name: string }>;
  for (const row of rows) {
    const list = map.get(row.capture_id) ?? [];
    list.push(row.name);
    map.set(row.capture_id, list);
  }
  return map;
}

function remindersForCaptures(db: Database.Database, ids: string[]): Map<string, Reminder> {
  const map = new Map<string, Reminder>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM reminders WHERE capture_id IN (${placeholders})`)
    .all(...ids) as Array<{
    capture_id: string;
    due_at: number;
    snooze_count: number;
    state: ReminderState;
    last_notified_at: number | null;
  }>;
  for (const row of rows) {
    map.set(row.capture_id, {
      captureId: row.capture_id,
      dueAt: row.due_at,
      snoozeCount: row.snooze_count,
      state: row.state,
      lastNotifiedAt: row.last_notified_at,
    });
  }
  return map;
}

function decisionFromRow(row: {
  capture_id: string;
  head_id: string;
  head_name: string;
  primitive: Primitive;
  value_text: string | null;
  value_num: number | null;
  probs_json: string;
  confidence: number;
  entropy: number;
  source: DecisionSource;
  model_version: string | null;
  latency_ms: number;
  updated_at: number;
}): Decision {
  return {
    captureId: row.capture_id,
    headId: row.head_id,
    headName: row.head_name,
    primitive: row.primitive,
    valueText: row.value_text,
    valueNum: row.value_num,
    probs: parseJson(row.probs_json, {}),
    confidence: row.confidence,
    entropy: row.entropy,
    source: row.source,
    modelVersion: row.model_version,
    latencyMs: row.latency_ms,
    updatedAt: row.updated_at,
  };
}

function decisionsForCaptures(db: Database.Database, ids: string[]): Map<string, Record<string, Decision>> {
  const map = new Map<string, Record<string, Decision>>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT cd.*, dh.name AS head_name, dh.primitive AS primitive
       FROM capture_decisions cd JOIN decision_heads dh ON dh.id = cd.head_id
       WHERE cd.capture_id IN (${placeholders}) ORDER BY dh.sort_order ASC`,
    )
    .all(...ids) as Array<{
    capture_id: string;
    head_id: string;
    head_name: string;
    primitive: Primitive;
    value_text: string | null;
    value_num: number | null;
    probs_json: string;
    confidence: number;
    entropy: number;
    source: DecisionSource;
    model_version: string | null;
    latency_ms: number;
    updated_at: number;
  }>;
  for (const row of rows) {
    const decisions = map.get(row.capture_id) ?? {};
    decisions[row.head_name] = decisionFromRow(row);
    map.set(row.capture_id, decisions);
  }
  return map;
}

function edgeCountsForCaptures(db: Database.Database, ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, (SELECT COUNT(*) FROM capture_edges e WHERE e.source_id = c.id OR e.target_id = c.id) AS count
       FROM captures c WHERE c.id IN (${placeholders})`,
    )
    .all(...ids) as Array<{ id: string; count: number }>;
  for (const row of rows) map.set(row.id, Number(row.count));
  return map;
}

function hydrateCaptures(
  db: Database.Database,
  rows: CaptureRow[],
  snippets: Map<string, string> = new Map(),
): Capture[] {
  const ids = rows.map((row) => row.id);
  const tags = tagsForCaptures(db, ids);
  const decisions = decisionsForCaptures(db, ids);
  const reminders = remindersForCaptures(db, ids);
  const edgeCounts = edgeCountsForCaptures(db, ids);
  return rows.map((row) =>
    captureFromRow(row, {
      tags: tags.get(row.id) ?? [],
      decisions: decisions.get(row.id) ?? {},
      reminder: reminders.get(row.id) ?? null,
      edgeCount: edgeCounts.get(row.id) ?? 0,
      snippet: snippets.get(row.id),
    }),
  );
}

export function getCapture(db: Database.Database, id: string): Capture | undefined {
  const row = getCaptureRow(db, id);
  return row ? hydrateCaptures(db, [row])[0] : undefined;
}

export function getCaptureDetail(
  db: Database.Database,
  id: string,
): (Capture & { edges: Edge[] }) | undefined {
  const capture = getCapture(db, id);
  return capture ? { ...capture, edges: listEdgesForCapture(db, id) } : undefined;
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
  const row = db
    .prepare(
      `SELECT c.content, c.url_title, c.url_excerpt,
              COALESCE(GROUP_CONCAT(t.name, ' '), '') AS tags_text
       FROM captures c
       LEFT JOIN capture_tags ct ON ct.capture_id = c.id
       LEFT JOIN tags t ON t.id = ct.tag_id
       WHERE c.id = ? GROUP BY c.id`,
    )
    .get(captureId) as
    | { content: string; tags_text: string; url_title: string | null; url_excerpt: string | null }
    | undefined;
  if (!row) return;
  db.prepare(
    `INSERT INTO captures_fts (capture_id, content, tags_text, url_title, url_excerpt)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(captureId, row.content, row.tags_text, row.url_title ?? '', row.url_excerpt ?? '');
}

export function deleteCaptureFts(db: Database.Database, captureId: string): void {
  db.prepare('DELETE FROM captures_fts WHERE capture_id = ?').run(captureId);
}

export function listTags(db: Database.Database, status: CaptureStatus = 'active'): Array<{ name: string; count: number }> {
  return db
    .prepare(
      `SELECT t.name, COUNT(DISTINCT c.id) AS count
       FROM tags t JOIN capture_tags ct ON ct.tag_id = t.id
       JOIN captures c ON c.id = ct.capture_id
       WHERE c.status = ?
       GROUP BY t.id, t.name ORDER BY count DESC, t.name ASC`,
    )
    .all(status) as Array<{ name: string; count: number }>;
}

export function bucketCounts(db: Database.Database, status?: CaptureStatus): Record<string, number> {
  const rows = status
    ? (db.prepare('SELECT bucket, COUNT(*) AS count FROM captures WHERE status = ? GROUP BY bucket').all(status) as Array<{
        bucket: string;
        count: number;
      }>)
    : (db.prepare('SELECT bucket, COUNT(*) AS count FROM captures GROUP BY bucket').all() as Array<{
        bucket: string;
        count: number;
      }>);
  const counts: Record<string, number> = { all: 0 };
  for (const bucket of BUCKETS) counts[bucket] = 0;
  for (const row of rows) {
    counts[row.bucket] = Number(row.count);
    counts.all = (counts.all ?? 0) + Number(row.count);
  }
  return counts;
}

const SPECIAL_TOKEN =
  /(-?)(bucket|b|status|mode|has|due|is):([a-z0-9_-]+)|(-?)#([^\s#]+)/giu;
const RESERVED_NAMES = new Set(['bucket', 'b', 'status', 'mode', 'has', 'due', 'is', 'http', 'https']);

export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = {
    buckets: { include: [], exclude: [] },
    statuses: { include: [], exclude: [] },
    tags: { include: [], exclude: [] },
    has: { include: [], exclude: [] },
    due: [],
    headFilters: [],
    text: '',
    ftsQuery: null,
  };

  let remaining = rawQuery.trim();
  remaining = remaining.replace(SPECIAL_TOKEN, (match, negA: string | undefined, keyA: string | undefined, valueA: string | undefined, negB: string | undefined, tag: string | undefined) => {
    const neg = negA === '-' || negB === '-';
    const key = keyA?.toLowerCase();
    const value = (valueA ?? tag ?? '').toLowerCase();
    if (key) {
      if (key === 'b' || key === 'bucket') parsed.buckets[neg ? 'exclude' : 'include'].push(value);
      else if (key === 'status') parsed.statuses[neg ? 'exclude' : 'include'].push(value);
      else if (key === 'mode' && (value === 'auto' || value === 'manual')) parsed.mode = value;
      else if (key === 'is' && value === 'pinned') parsed.pinned = !neg;
      else if (key === 'has') parsed.has[neg ? 'exclude' : 'include'].push(value);
      else if (key === 'due') parsed.due.push(value);
    } else if (tag) {
      parsed.tags[neg ? 'exclude' : 'include'].push(tag.toLowerCase());
    }
    return ' ';
  });

  remaining = remaining.replace(
    /([a-z_][a-z0-9_]*)(>=|<=|>|<|:)([^\s]+)/giu,
    (match, rawName: string, op: string, rawValue: string) => {
      const name = rawName.toLowerCase();
      if (RESERVED_NAMES.has(name) || rawValue.startsWith('//')) return match;
      parsed.headFilters.push({ head: name, op: op as HeadOperator, value: rawValue });
      return ' ';
    },
  );

  const words: string[] = [];
  for (const token of remaining.match(/"[^"]+"|\S+/gu) ?? []) {
    const cleaned = token
      .replace(/^["']+|["']+$/g, '')
      .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
      .trim();
    if (cleaned) words.push(cleaned);
  }
  parsed.text = words.join(' ');
  parsed.ftsQuery = words.length > 0 ? words.map((word) => `"${word.replaceAll('"', '""')}"*`).join(' ') : null;
  return parsed;
}

function ownerDayStart(now: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: config.OWNER_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
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

function buildFilters(
  filters: CaptureFilters,
  parsed: ParsedSearchQuery,
  now: number,
): { joins: string[]; where: string[]; params: unknown[]; ftsActive: boolean } {
  const joins: string[] = [];
  const where: string[] = [];
  const params: unknown[] = [];
  let ftsActive = false;

  if (filters.bucket) {
    where.push('c.bucket = ?');
    params.push(filters.bucket);
  }
  if (filters.status && filters.status !== 'all') {
    where.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id
               WHERE ct.capture_id = c.id AND t.name = ?)`,
    );
    params.push(normalizeTags([filters.tag])[0] ?? filters.tag.toLowerCase());
  }

  if (parsed.buckets.include.length > 0) {
    where.push(`c.bucket IN (${parsed.buckets.include.map(() => '?').join(', ')})`);
    params.push(...parsed.buckets.include);
  }
  if (parsed.buckets.exclude.length > 0) {
    where.push(`c.bucket NOT IN (${parsed.buckets.exclude.map(() => '?').join(', ')})`);
    params.push(...parsed.buckets.exclude);
  }
  if (parsed.statuses.include.length > 0 && !parsed.statuses.include.includes('all')) {
    where.push(`c.status IN (${parsed.statuses.include.map(() => '?').join(', ')})`);
    params.push(...parsed.statuses.include);
  }
  if (parsed.statuses.exclude.length > 0 && !parsed.statuses.exclude.includes('all')) {
    where.push(`c.status NOT IN (${parsed.statuses.exclude.map(() => '?').join(', ')})`);
    params.push(...parsed.statuses.exclude);
  }
  for (const tag of parsed.tags.include) {
    where.push(
      `EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id
               WHERE ct.capture_id = c.id AND t.name = ?)`,
    );
    params.push(tag);
  }
  for (const tag of parsed.tags.exclude) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id
                   WHERE ct.capture_id = c.id AND t.name = ?)`,
    );
    params.push(tag);
  }
  if (parsed.pinned !== undefined) {
    where.push('c.is_pinned = ?');
    params.push(parsed.pinned ? 1 : 0);
  }
  if (parsed.mode) {
    where.push('c.capture_mode = ?');
    params.push(parsed.mode);
  }
  for (const has of parsed.has.include) {
    if (has === 'url') where.push("c.source_url IS NOT NULL AND c.source_url <> ''");
    else if (has === 'due') where.push('EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id)');
    else if (has === 'links') where.push('EXISTS (SELECT 1 FROM capture_edges e WHERE e.source_id = c.id OR e.target_id = c.id)');
    else where.push('0 = 1');
  }
  for (const has of parsed.has.exclude) {
    if (has === 'url') where.push("(c.source_url IS NULL OR c.source_url = '')");
    else if (has === 'due') where.push('NOT EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id)');
    else if (has === 'links') where.push('NOT EXISTS (SELECT 1 FROM capture_edges e WHERE e.source_id = c.id OR e.target_id = c.id)');
  }

  const dayStart = ownerDayStart(now);
  for (const due of parsed.due) {
    if (due === 'overdue') {
      where.push("EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id AND r.state IN ('pending','notified') AND r.due_at < ?)");
      params.push(now);
    } else if (due === 'today') {
      where.push('EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id AND r.due_at >= ? AND r.due_at < ?)');
      params.push(dayStart, dayStart + 86_400_000);
    } else if (due === 'week') {
      where.push('EXISTS (SELECT 1 FROM reminders r WHERE r.capture_id = c.id AND r.due_at >= ? AND r.due_at < ?)');
      params.push(now, now + 7 * 86_400_000);
    } else {
      where.push('0 = 1');
    }
  }

  for (const filter of parsed.headFilters) {
    const value = filter.value;
    const numeric = Number(value);
    if (filter.head === 'entropy' || (filter.op !== ':' && Number.isFinite(numeric))) {
      const column = filter.head === 'entropy' ? 'cd.entropy' : 'cd.value_num';
      const op = filter.op === ':' ? '=' : filter.op;
      where.push(
        `EXISTS (SELECT 1 FROM capture_decisions cd JOIN decision_heads dh ON dh.id = cd.head_id
                 WHERE cd.capture_id = c.id AND (dh.name = ? OR dh.id = ?) AND ${column} ${op} ?)`,
      );
      params.push(filter.head, filter.head, filter.head === 'entropy' ? Number(value) : numeric);
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM capture_decisions cd JOIN decision_heads dh ON dh.id = cd.head_id
                 WHERE cd.capture_id = c.id AND (dh.name = ? OR dh.id = ?)
                   AND (LOWER(COALESCE(cd.value_text, '')) = LOWER(?) OR LOWER(COALESCE(cd.probs_json, '')) LIKE ?))`,
      );
      params.push(filter.head, filter.head, value, `%"${value.toLowerCase()}"%`);
    }
  }

  if (parsed.ftsQuery) {
    joins.push('JOIN captures_fts fts ON fts.capture_id = c.id');
    where.push('captures_fts MATCH ?');
    params.push(parsed.ftsQuery);
    ftsActive = true;
  }

  return { joins, where, params, ftsActive };
}

function orderByFor(filters: CaptureFilters, ftsActive: boolean): { sql: string; joins: string[]; params: unknown[] } {
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const sort = filters.sort ?? (ftsActive ? 'recent' : 'recent');
  const joins: string[] = [];
  const params: unknown[] = [];
  if (sort === 'updated') return { sql: `c.updated_at ${direction}, c.rowid ${direction}`, joins, params };
  if (sort === 'due') {
    joins.push('LEFT JOIN reminders sort_r ON sort_r.capture_id = c.id');
    return { sql: `sort_r.due_at IS NULL, sort_r.due_at ${direction}, c.created_at ${direction}`, joins, params };
  }
  if (sort === 'entropy') {
    joins.push('LEFT JOIN (SELECT capture_id, MAX(entropy) AS entropy FROM capture_decisions GROUP BY capture_id) sort_ent ON sort_ent.capture_id = c.id');
    return { sql: `sort_ent.entropy ${direction}, c.created_at ${direction}`, joins, params };
  }
  if (sort.startsWith('head:')) {
    const headName = sort.slice('head:'.length);
    joins.push('LEFT JOIN decision_heads sort_dh ON sort_dh.name = ?');
    params.push(headName);
    joins.push('LEFT JOIN capture_decisions sort_cd ON sort_cd.capture_id = c.id AND sort_cd.head_id = sort_dh.id');
    return { sql: `sort_cd.value_num ${direction}, sort_cd.value_text ${direction}, c.created_at ${direction}`, joins, params };
  }
  return { sql: `c.is_pinned DESC, c.created_at ${direction}, c.rowid ${direction}`, joins, params };
}

export function listCaptures(db: Database.Database, filters: CaptureFilters = {}): CapturePage {
  const now = Date.now();
  const parsed = parseSearchQuery(filters.q ?? '');
  const filtered = buildFilters(filters, parsed, now);
  const joins = filtered.joins.join(' ');
  const where = filtered.where.length > 0 ? filtered.where.join(' AND ') : '1 = 1';
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM captures c ${joins} WHERE ${where}`)
    .get(...filtered.params) as { count: number };

  const order = orderByFor(filters, filtered.ftsActive);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const snippetSelect = filtered.ftsActive
    ? ", snippet(captures_fts, 1, '<mark>', '</mark>', '…', 24) AS snippet"
    : '';
  const rows = db
    .prepare(
      `SELECT c.*${snippetSelect} FROM captures c ${joins} ${order.joins.join(' ')}
       WHERE ${where} ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
    )
    .all(...order.params, ...filtered.params, limit, offset) as CaptureRow[];
  const snippets = new Map<string, string>();
  if (filtered.ftsActive) {
    for (const row of rows as Array<CaptureRow & { snippet?: string }>) {
      if (row.snippet) snippets.set(row.id, row.snippet);
    }
  }
  return {
    captures: hydrateCaptures(db, rows, snippets),
    total: Number(countRow.count),
    bucketCounts: bucketCounts(db, filters.status === 'all' ? undefined : filters.status),
  };
}

export function getDecisionsForCapture(db: Database.Database, captureId: string): Decision[] {
  const decisions = decisionsForCaptures(db, [captureId]).get(captureId) ?? {};
  return Object.values(decisions);
}

export interface UpsertDecisionInput {
  captureId: string;
  headId: string;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  source: DecisionSource;
  modelVersion?: string | null;
  latencyMs?: number;
  updatedAt?: number;
}

export function upsertDecision(db: Database.Database, input: UpsertDecisionInput): void {
  db.prepare(
    `INSERT INTO capture_decisions
       (capture_id, head_id, value_text, value_num, probs_json, confidence, entropy, source,
        model_version, latency_ms, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id, head_id) DO UPDATE SET
       value_text = excluded.value_text, value_num = excluded.value_num, probs_json = excluded.probs_json,
       confidence = excluded.confidence, entropy = excluded.entropy, source = excluded.source,
       model_version = excluded.model_version, latency_ms = excluded.latency_ms, updated_at = excluded.updated_at`,
  ).run(
    input.captureId,
    input.headId,
    input.valueText,
    input.valueNum,
    JSON.stringify(input.probs),
    input.confidence,
    input.entropy,
    input.source,
    input.modelVersion ?? null,
    input.latencyMs ?? 0,
    input.updatedAt ?? Date.now(),
  );
}

export function deleteDecision(db: Database.Database, captureId: string, headId: string): void {
  db.prepare('DELETE FROM capture_decisions WHERE capture_id = ? AND head_id = ?').run(captureId, headId);
}

export function listHeads(db: Database.Database, activeOnly = false): Head[] {
  const rows = db
    .prepare(
      `SELECT * FROM decision_heads ${activeOnly ? 'WHERE active = 1' : ''}
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all() as HeadRow[];
  return rows.map(headFromRow);
}

export function getHeadRow(db: Database.Database, id: string): HeadRow | undefined {
  return db.prepare('SELECT * FROM decision_heads WHERE id = ?').get(id) as HeadRow | undefined;
}

export function getHeadByName(db: Database.Database, name: string): HeadRow | undefined {
  return db.prepare('SELECT * FROM decision_heads WHERE name = ?').get(name) as HeadRow | undefined;
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
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, value, Date.now());
}

export function insertEdge(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  relation: EdgeRelation,
  note: string | null = null,
): void {
  db.prepare(
    `INSERT INTO capture_edges (source_id, target_id, relation, note, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_id, target_id, relation) DO UPDATE SET note = excluded.note`,
  ).run(sourceId, targetId, relation, note, Date.now());
}

export function deleteEdge(db: Database.Database, sourceId: string, targetId: string, relation: EdgeRelation): void {
  db.prepare('DELETE FROM capture_edges WHERE source_id = ? AND target_id = ? AND relation = ?').run(
    sourceId,
    targetId,
    relation,
  );
}

export function listEdgesForCapture(db: Database.Database, captureId: string): Edge[] {
  const rows = db
    .prepare(
      `SELECT e.*,
              CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END AS other_id,
              c.content AS other_content, c.bucket AS other_bucket, c.status AS other_status,
              CASE WHEN e.source_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
       FROM capture_edges e JOIN captures c ON c.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
       WHERE e.source_id = ? OR e.target_id = ?
       ORDER BY e.created_at DESC`,
    )
    .all(captureId, captureId, captureId, captureId, captureId) as Array<{
    source_id: string;
    target_id: string;
    relation: EdgeRelation;
    note: string | null;
    created_at: number;
    other_id: string;
    other_content: string;
    other_bucket: Bucket;
    other_status: CaptureStatus;
    direction: 'outgoing' | 'incoming';
  }>;
  return rows.map((row) => ({
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    note: row.note,
    createdAt: row.created_at,
    otherId: row.other_id,
    otherContent: row.other_content,
    otherBucket: row.other_bucket,
    otherStatus: row.other_status,
    direction: row.direction,
  }));
}

export function getReminder(db: Database.Database, captureId: string): Reminder | undefined {
  return remindersForCaptures(db, [captureId]).get(captureId);
}

export interface UpsertReminderInput {
  dueAt: number;
  state?: ReminderState;
  snoozeCount?: number;
  lastNotifiedAt?: number | null;
}

export function upsertReminder(db: Database.Database, captureId: string, input: UpsertReminderInput): void {
  db.prepare(
    `INSERT INTO reminders (capture_id, due_at, state, snooze_count, last_notified_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET
       due_at = excluded.due_at, state = excluded.state, snooze_count = excluded.snooze_count,
       last_notified_at = excluded.last_notified_at`,
  ).run(
    captureId,
    input.dueAt,
    input.state ?? 'pending',
    input.snoozeCount ?? 0,
    input.lastNotifiedAt ?? null,
  );
}

export function listDueReminders(db: Database.Database, now: number): Reminder[] {
  const rows = db
    .prepare(`SELECT * FROM reminders WHERE state = 'pending' AND due_at <= ? ORDER BY due_at ASC`)
    .all(now) as Array<{
    capture_id: string;
    due_at: number;
    snooze_count: number;
    state: ReminderState;
    last_notified_at: number | null;
  }>;
  return rows.map((row) => ({
    captureId: row.capture_id,
    dueAt: row.due_at,
    snoozeCount: row.snooze_count,
    state: row.state,
    lastNotifiedAt: row.last_notified_at,
  }));
}

export function listReminders(db: Database.Database): Reminder[] {
  const rows = db
    .prepare(`SELECT * FROM reminders WHERE state IN ('pending','notified') ORDER BY due_at ASC`)
    .all() as Array<{
    capture_id: string;
    due_at: number;
    snooze_count: number;
    state: ReminderState;
    last_notified_at: number | null;
  }>;
  return rows.map((row) => ({
    captureId: row.capture_id,
    dueAt: row.due_at,
    snoozeCount: row.snooze_count,
    state: row.state,
    lastNotifiedAt: row.last_notified_at,
  }));
}

export function getAgenda(db: Database.Database, now = Date.now()): Agenda {
  const dayStart = ownerDayStart(now);
  const rows = db
    .prepare(
      `SELECT r.*, c.content, c.bucket, c.status, c.is_pinned
       FROM reminders r JOIN captures c ON c.id = r.capture_id
       WHERE r.state IN ('pending','notified') ORDER BY r.due_at ASC`,
    )
    .all() as Array<{
    capture_id: string;
    due_at: number;
    snooze_count: number;
    state: ReminderState;
    last_notified_at: number | null;
    content: string;
    bucket: Bucket;
    status: CaptureStatus;
    is_pinned: number;
  }>;
  const agenda: Agenda = { overdue: [], today: [], upcoming: [], snoozed: [] };
  for (const row of rows) {
    const item: AgendaItem = {
      captureId: row.capture_id,
      dueAt: row.due_at,
      snoozeCount: row.snooze_count,
      state: row.state,
      lastNotifiedAt: row.last_notified_at,
      content: row.content,
      bucket: row.bucket,
      status: row.status,
      isPinned: row.is_pinned === 1,
    };
    if (item.snoozeCount >= 3) agenda.snoozed.push(item);
    if (item.dueAt < now) agenda.overdue.push(item);
    else if (item.dueAt < dayStart + 86_400_000) agenda.today.push(item);
    else agenda.upcoming.push(item);
  }
  return agenda;
}

export function getReviewQueue(db: Database.Database): { uncertain: ReviewCapture[]; unclassified: ReviewCapture[] } {
  const uncertainRows = db
    .prepare(
      `SELECT DISTINCT c.id FROM captures c
       JOIN capture_decisions cd ON cd.capture_id = c.id
       JOIN decision_heads dh ON dh.id = cd.head_id
       WHERE c.status = 'active' AND dh.active = 1 AND cd.source = 'jev'
         AND cd.entropy > dh.entropy_threshold`,
    )
    .all() as Array<{ id: string }>;
  const unclassifiedRows = db
    .prepare(
      `SELECT c.id FROM captures c WHERE c.status = 'active' AND c.capture_mode = 'auto'
       AND NOT EXISTS (SELECT 1 FROM capture_decisions cd WHERE cd.capture_id = c.id)`,
    )
    .all() as Array<{ id: string }>;
  const withReasons = (ids: string[]): ReviewCapture[] =>
    ids.flatMap((id) => {
      const capture = getCapture(db, id);
      if (!capture) return [];
      const decisions = Object.values(capture.decisions);
      const reviewDecisions = decisions.filter((decision) => {
        const head = getHeadRow(db, decision.headId);
        return head && head.active === 1 && decision.source === 'jev' && decision.entropy > head.entropy_threshold;
      });
      return [{ ...capture, reviewDecisions }];
    });
  return { uncertain: withReasons(uncertainRows.map((row) => row.id)), unclassified: withReasons(unclassifiedRows.map((row) => row.id)) };
}

export function listSavedViews(db: Database.Database): SavedView[] {
  const rows = db.prepare('SELECT * FROM saved_views ORDER BY sort_order ASC, created_at ASC').all() as Array<{
    id: string;
    name: string;
    query: string;
    sort: string;
    sort_order: number;
    created_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    query: row.query,
    sort: row.sort,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }));
}

export function createSavedView(db: Database.Database, input: { id: string; name: string; query: string; sort?: string; sortOrder?: number }): SavedView {
  const now = Date.now();
  db.prepare(
    `INSERT INTO saved_views (id, name, query, sort, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.name, input.query, input.sort ?? 'recent', input.sortOrder ?? 0, now);
  return { id: input.id, name: input.name, query: input.query, sort: input.sort ?? 'recent', sortOrder: input.sortOrder ?? 0, createdAt: now };
}

export function updateSavedView(
  db: Database.Database,
  id: string,
  patch: Partial<Pick<SavedView, 'name' | 'query' | 'sort' | 'sortOrder'>>,
): SavedView | undefined {
  const current = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as
    | { id: string; name: string; query: string; sort: string; sort_order: number; created_at: number }
    | undefined;
  if (!current) return undefined;
  const name = patch.name ?? current.name;
  const query = patch.query ?? current.query;
  const sort = patch.sort ?? current.sort;
  const sortOrder = patch.sortOrder ?? current.sort_order;
  db.prepare('UPDATE saved_views SET name = ?, query = ?, sort = ?, sort_order = ? WHERE id = ?').run(
    name,
    query,
    sort,
    sortOrder,
    id,
  );
  return { id, name, query, sort, sortOrder, createdAt: current.created_at };
}

export function deleteSavedView(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM saved_views WHERE id = ?').run(id).changes > 0;
}

export function recordJevUsage(
  db: Database.Database,
  input: {
    triggerReason: string;
    modelVersion: string | null;
    heads: string[];
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
  },
): void {
  db.prepare(
    `INSERT INTO jev_usage (trigger_reason, model_version, heads_json, input_tokens, output_tokens, cost_usd, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.triggerReason,
    input.modelVersion,
    JSON.stringify(input.heads),
    input.inputTokens,
    input.outputTokens,
    input.costUsd,
    input.latencyMs,
    Date.now(),
  );
}

export function jevUsageTotals(db: Database.Database): { todayCalls: number; todayUsd: number; monthUsd: number } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const day = db
    .prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS usd FROM jev_usage WHERE created_at >= ?')
    .get(startOfDay) as { calls: number; usd: number };
  const month = db
    .prepare('SELECT COALESCE(SUM(cost_usd),0) AS usd FROM jev_usage WHERE created_at >= ?')
    .get(startOfMonth) as { usd: number };
  return { todayCalls: Number(day.calls), todayUsd: Number(day.usd), monthUsd: Number(month.usd) };
}
