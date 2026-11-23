import type Database from 'better-sqlite3';

export type Bucket = 'idea' | 'memory' | 'reminder' | 'question' | 'reference' | 'noise';
export type CaptureStatus = 'active' | 'resolved' | 'sublimated';
export type EdgeRelation =
  | 'refines'
  | 'reinforces'
  | 'contradicts'
  | 'paradox'
  | 'answers'
  | 'duplicate_of'
  | 'reply';
export type Primitive = 'choice' | 'score' | 'noul';
export type DecisionSource = 'deterministic' | 'local_probe' | 'local_knn' | 'jev' | 'human';

export const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];

export interface Capture {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  energy: number;
  decayLambda: number;
  resonanceCount: number;
  lastActivatedAt: number;
  simhash: string | null;
  meta: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CaptureRow {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  is_pinned: number;
  energy: number;
  decay_lambda: number;
  resonance_count: number;
  last_activated_at: number;
  simhash: string | null;
  embedding: Buffer | null;
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
  autoEscalate: boolean;
  localThreshold: number;
  sampleCount: number;
  agreementCount: number;
  evalCount: number;
  active: boolean;
  isSystem: boolean;
  createdAt: number;
}

export interface HeadRow {
  id: string;
  name: string;
  primitive: Primitive;
  instructions: string;
  config_json: string;
  auto_escalate: number;
  local_threshold: number;
  probe_weights: Buffer | null;
  sample_count: number;
  agreement_count: number;
  eval_count: number;
  active: number;
  is_system: number;
  created_at: number;
}

export interface Decision {
  id: number;
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
  latencyMs: number;
  createdAt: number;
}

export interface Edge {
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight: number;
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface Reminder {
  captureId: string;
  dueAt: number;
  snoozeCount: number;
  state: 'pending' | 'notified' | 'done' | 'killed';
  lastNotifiedAt: number | null;
}

export interface HeadFilter {
  head: string;
  min?: number;
  max?: number;
}

export interface CaptureFilters {
  bucket?: Bucket;
  status?: CaptureStatus;
  tag?: string;
  q?: string;
  paradoxOnly?: boolean;
  minResonance?: number;
  minEnergy?: number;
  maxEnergy?: number;
  headFilters?: HeadFilter[];
  sort?: 'recent' | 'energy' | 'resonance' | 'leverage' | 'entropy';
  limit?: number;
  offset?: number;
  semantic?: Array<{ id: string; score: number }>;
}

export interface CapturePage {
  captures: Capture[];
  total: number;
  bucketCounts: Record<string, number>;
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

export function headFromRow(row: HeadRow): Head {
  return {
    id: row.id,
    name: row.name,
    primitive: row.primitive,
    instructions: row.instructions,
    config: parseJson(row.config_json, {}),
    autoEscalate: row.auto_escalate === 1,
    localThreshold: row.local_threshold,
    sampleCount: row.sample_count,
    agreementCount: row.agreement_count,
    evalCount: row.eval_count,
    active: row.active === 1,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
  };
}

export function captureFromRow(row: CaptureRow, tags: string[] = []): Capture {
  return {
    id: row.id,
    content: row.content,
    bucket: row.bucket,
    status: row.status,
    isPinned: row.is_pinned === 1,
    energy: row.energy,
    decayLambda: row.decay_lambda,
    resonanceCount: row.resonance_count,
    lastActivatedAt: row.last_activated_at,
    simhash: row.simhash,
    meta: parseJson(row.meta, {}),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildFtsQuery(input: string): string | null {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}_]/u.test(token))
    .map((token) => token.replaceAll('"', '""'))
    .map((token) => `"${token}"*`);
  return tokens.length > 0 ? tokens.join(' ') : null;
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

export function getCaptureRow(db: Database.Database, id: string): CaptureRow | undefined {
  return db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as CaptureRow | undefined;
}

export function getCapture(db: Database.Database, id: string): Capture | undefined {
  const row = getCaptureRow(db, id);
  if (!row) return undefined;
  return captureFromRow(row, tagsForCaptures(db, [id]).get(id) ?? []);
}

export function getCapturesByIds(db: Database.Database, ids: string[]): Map<string, Capture> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM captures WHERE id IN (${placeholders})`)
    .all(...ids) as CaptureRow[];
  const tags = tagsForCaptures(db, ids);
  return new Map(rows.map((row) => [row.id, captureFromRow(row, tags.get(row.id) ?? [])]));
}

export function setCaptureTags(db: Database.Database, id: string, tags: string[]): void {
  db.prepare('DELETE FROM capture_tags WHERE capture_id = ?').run(id);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)');
  for (const tag of tags) {
    insertTag.run(tag);
    const row = findTag.get(tag) as { id: number } | undefined;
    if (row) link.run(id, row.id);
  }
}

export function deleteOrphanTags(db: Database.Database): void {
  db.prepare('DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM capture_tags ct WHERE ct.tag_id = tags.id)').run();
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

function headFilterSql(filters: HeadFilter[]): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  for (const filter of filters) {
    let clause = `EXISTS (
      SELECT 1 FROM capture_decisions cd
      JOIN decision_heads dh ON dh.id = cd.head_id
      WHERE cd.capture_id = c.id AND (dh.name = ? OR dh.id = ?)
        AND cd.id = (SELECT MAX(cd2.id) FROM capture_decisions cd2 WHERE cd2.capture_id = c.id AND cd2.head_id = cd.head_id)`;
    params.push(filter.head, filter.head);
    if (filter.min !== undefined) {
      clause += ' AND cd.value_num >= ?';
      params.push(filter.min);
    }
    if (filter.max !== undefined) {
      clause += ' AND cd.value_num <= ?';
      params.push(filter.max);
    }
    clause += ')';
    sql.push(clause);
  }
  return { sql, params };
}

export function listCaptures(db: Database.Database, filters: CaptureFilters = {}): CapturePage {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    where.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.bucket) {
    where.push('c.bucket = ?');
    params.push(filters.bucket);
  }
  if (filters.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id
               WHERE ct.capture_id = c.id AND t.name = ?)`,
    );
    params.push(filters.tag.trim().toLowerCase());
  }
  if (filters.paradoxOnly) {
    where.push(
      `EXISTS (SELECT 1 FROM capture_edges e WHERE e.relation = 'paradox'
               AND (e.source_id = c.id OR e.target_id = c.id))`,
    );
  }
  if (filters.minResonance !== undefined) {
    where.push('c.resonance_count >= ?');
    params.push(filters.minResonance);
  }
  if (filters.minEnergy !== undefined) {
    where.push('c.energy >= ?');
    params.push(filters.minEnergy);
  }
  if (filters.maxEnergy !== undefined) {
    where.push('c.energy <= ?');
    params.push(filters.maxEnergy);
  }
  const headSql = headFilterSql(filters.headFilters ?? []);
  where.push(...headSql.sql);
  params.push(...headSql.params);

  let joins = '';
  const baseWhere = where.join(' AND ') || '1 = 1';
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM captures c ${joins} WHERE ${baseWhere}`)
    .get(...params) as { count: number };

  let orderBy = 'c.is_pinned DESC, c.created_at DESC, c.rowid DESC';
  if (filters.sort === 'energy') orderBy = 'c.energy DESC, c.created_at DESC';
  if (filters.sort === 'resonance') orderBy = 'c.resonance_count DESC, c.created_at DESC';
  if (filters.sort === 'leverage') orderBy = 'c.is_pinned DESC, c.created_at DESC';
  if (filters.sort === 'entropy') orderBy = 'c.is_pinned DESC, c.created_at DESC';

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  let rows: CaptureRow[];
  let total = Number(countRow.count);
  if (filters.q) {
    const ftsQuery = buildFtsQuery(filters.q);
    const bm25 = new Map<string, number>();
    if (ftsQuery) {
      const ftsRows = db
        .prepare(
          `SELECT c.id, bm25(captures_fts) AS rank FROM captures_fts
           JOIN captures c ON c.rowid = captures_fts.rowid
           WHERE captures_fts MATCH ? LIMIT 500`,
        )
        .all(ftsQuery) as Array<{ id: string; rank: number }>;
      ftsRows.forEach((row, index) => bm25.set(row.id, index));
    }
    const semantic = new Map<string, number>();
    (filters.semantic ?? []).forEach((item, index) => semantic.set(item.id, index));

    const all = db.prepare(`SELECT * FROM captures c ${joins} WHERE ${baseWhere}`).all(...params) as CaptureRow[];
    const scored = all
      .map((row) => {
        let score = 0;
        const ftsRank = bm25.get(row.id);
        const semRank = semantic.get(row.id);
        if (ftsRank !== undefined) score += 1 / (60 + ftsRank);
        if (semRank !== undefined) score += 1 / (60 + semRank);
        return { row, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.row.created_at - a.row.created_at);
    total = scored.length;
    rows = scored.slice(offset, offset + limit).map((item) => item.row);
  } else {
    rows = db
      .prepare(`SELECT c.* FROM captures c ${joins} WHERE ${baseWhere} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as CaptureRow[];
    if (filters.sort === 'leverage' || filters.sort === 'entropy') {
      // Rare sort modes need the latest decision value; keep SQL simple and sort the page in JS.
      const decisions = latestDecisionsFor(db, rows.map((row) => row.id));
      rows.sort((a, b) => {
        const key = filters.sort === 'leverage' ? 'leverage' : 'entropy';
        const av = decisionSortValue(decisions.get(a.id), key);
        const bv = decisionSortValue(decisions.get(b.id), key);
        return bv - av;
      });
    }
  }

  const tags = tagsForCaptures(db, rows.map((row) => row.id));
  return {
    captures: rows.map((row) => captureFromRow(row, tags.get(row.id) ?? [])),
    total,
    bucketCounts: bucketCounts(db, filters.status),
  };
}

function decisionSortValue(decisions: Decision[] | undefined, key: 'leverage' | 'entropy'): number {
  if (!decisions) return 0;
  if (key === 'entropy') return decisions.reduce((sum, item) => sum + item.entropy, 0) / Math.max(decisions.length, 1);
  const leverage = decisions.find((item) => item.headName === 'leverage');
  return leverage?.valueNum ?? 0;
}

export function latestDecisionsFor(db: Database.Database, captureIds: string[]): Map<string, Decision[]> {
  const map = new Map<string, Decision[]>();
  if (captureIds.length === 0) return map;
  const placeholders = captureIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT cd.*, dh.name AS head_name, dh.primitive AS primitive
       FROM capture_decisions cd JOIN decision_heads dh ON dh.id = cd.head_id
       WHERE cd.capture_id IN (${placeholders})
       ORDER BY cd.created_at DESC, cd.id DESC`,
    )
    .all(...captureIds) as Array<{
    id: number;
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
    latency_ms: number;
    created_at: number;
  }>;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.capture_id}:${row.head_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = map.get(row.capture_id) ?? [];
    list.push({
      id: row.id,
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
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
    });
    map.set(row.capture_id, list);
  }
  return map;
}

export function getDecisionsForCapture(db: Database.Database, captureId: string): Decision[] {
  return Array.from(latestDecisionsFor(db, [captureId]).values()).flat();
}

export function insertDecision(
  db: Database.Database,
  input: {
    captureId: string;
    headId: string;
    valueText: string | null;
    valueNum: number | null;
    probs: Record<string, number>;
    confidence: number;
    entropy: number;
    source: DecisionSource;
    latencyMs: number;
  },
): void {
  db.prepare(
    `INSERT INTO capture_decisions
       (capture_id, head_id, value_text, value_num, probs_json, confidence, entropy, source, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.captureId,
    input.headId,
    input.valueText,
    input.valueNum,
    JSON.stringify(input.probs),
    input.confidence,
    input.entropy,
    input.source,
    input.latencyMs,
    Date.now(),
  );
}

export function listHeads(db: Database.Database, activeOnly = false): Head[] {
  const rows = db
    .prepare(`SELECT * FROM decision_heads ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY is_system DESC, created_at ASC`)
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
  weight = 1,
  meta: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO capture_edges (source_id, target_id, relation, weight, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, target_id, relation) DO UPDATE SET weight = excluded.weight, meta = excluded.meta`,
  ).run(sourceId, targetId, relation, weight, JSON.stringify(meta), Date.now());
}

export function listEdgesForCapture(db: Database.Database, captureId: string): Edge[] {
  const rows = db
    .prepare('SELECT * FROM capture_edges WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC')
    .all(captureId, captureId) as Array<{
    source_id: string;
    target_id: string;
    relation: EdgeRelation;
    weight: number;
    meta: string;
    created_at: number;
  }>;
  return rows.map((row) => ({
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    weight: row.weight,
    meta: parseJson(row.meta, {}),
    createdAt: row.created_at,
  }));
}

export function hasParadoxEdge(db: Database.Database, captureId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM capture_edges WHERE relation = 'paradox' AND (source_id = ? OR target_id = ?) LIMIT 1`,
    )
    .get(captureId, captureId);
  return row !== undefined;
}

export function getReminder(db: Database.Database, captureId: string): Reminder | undefined {
  const row = db.prepare('SELECT * FROM reminders WHERE capture_id = ?').get(captureId) as
    | {
        capture_id: string;
        due_at: number;
        snooze_count: number;
        state: Reminder['state'];
        last_notified_at: number | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    captureId: row.capture_id,
    dueAt: row.due_at,
    snoozeCount: row.snooze_count,
    state: row.state,
    lastNotifiedAt: row.last_notified_at,
  };
}

export function upsertReminder(db: Database.Database, captureId: string, dueAt: number): void {
  db.prepare(
    `INSERT INTO reminders (capture_id, due_at, state) VALUES (?, ?, 'pending')
     ON CONFLICT(capture_id) DO UPDATE SET due_at = excluded.due_at, state = 'pending'`,
  ).run(captureId, dueAt);
}

export function listDueReminders(db: Database.Database, now: number): Reminder[] {
  const rows = db
    .prepare(`SELECT * FROM reminders WHERE state = 'pending' AND due_at <= ? ORDER BY due_at ASC`)
    .all(now) as Array<{
    capture_id: string;
    due_at: number;
    snooze_count: number;
    state: Reminder['state'];
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

export function listReminders(db: Database.Database): Array<Reminder & { content: string }> {
  const rows = db
    .prepare(
      `SELECT r.*, c.content FROM reminders r JOIN captures c ON c.id = r.capture_id
       WHERE r.state IN ('pending','notified') ORDER BY r.due_at ASC`,
    )
    .all() as Array<{
    capture_id: string;
    due_at: number;
    snooze_count: number;
    state: Reminder['state'];
    last_notified_at: number | null;
    content: string;
  }>;
  return rows.map((row) => ({
    captureId: row.capture_id,
    dueAt: row.due_at,
    snoozeCount: row.snooze_count,
    state: row.state,
    lastNotifiedAt: row.last_notified_at,
    content: row.content,
  }));
}

export function recordJevUsage(
  db: Database.Database,
  input: {
    triggerReason: string;
    heads: string[];
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
  },
): void {
  db.prepare(
    `INSERT INTO jev_usage (trigger_reason, heads_json, input_tokens, output_tokens, cost_usd, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.triggerReason,
    JSON.stringify(input.heads),
    input.inputTokens,
    input.outputTokens,
    input.costUsd,
    input.latencyMs,
    Date.now(),
  );
}

export function jevUsageTotals(db: Database.Database): {
  todayCalls: number;
  todayUsd: number;
  monthUsd: number;
} {
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

export function localHitRate(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN source IN ('local_probe','local_knn','deterministic') THEN 1 ELSE 0 END) AS local,
         COUNT(*) AS total FROM capture_decisions`,
    )
    .get() as { local: number | null; total: number };
  return row.total > 0 ? Number(row.local ?? 0) / Number(row.total) : 0;
}

export function getGraph(db: Database.Database): {
  nodes: Array<Capture & { decisions: Decision[] }>;
  edges: Edge[];
} {
  const rows = db
    .prepare('SELECT * FROM captures WHERE status = ? ORDER BY created_at DESC LIMIT 1000')
    .all('active') as CaptureRow[];
  const ids = rows.map((row) => row.id);
  const tags = tagsForCaptures(db, ids);
  const decisions = latestDecisionsFor(db, ids);
  const edges = db.prepare('SELECT * FROM capture_edges').all() as Array<{
    source_id: string;
    target_id: string;
    relation: EdgeRelation;
    weight: number;
    meta: string;
    created_at: number;
  }>;
  return {
    nodes: rows.map((row) => ({
      ...captureFromRow(row, tags.get(row.id) ?? []),
      decisions: decisions.get(row.id) ?? [],
    })),
    edges: edges.map((row) => ({
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation,
      weight: row.weight,
      meta: parseJson(row.meta, {}),
      createdAt: row.created_at,
    })),
  };
}

export function summaryStats(db: Database.Database): { total: number; buckets: Record<string, number> } {
  return { total: (bucketCounts(db).all ?? 0) as number, buckets: bucketCounts(db) };
}
