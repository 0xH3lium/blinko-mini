import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.OWNER_TIMEZONE = 'Asia/Tehran';

const Database = (await import('better-sqlite3')).default;
const { createDatabase, runMigrations } = await import('../src/db/client.js');
const {
  getSetting, listFields, listRules, listTemplates, listSavedViews, listCaptures, parseSearchQuery,
  setCaptureTags, syncCaptureFts, normalizeSearchText, upsertFieldValue, getField, upsertReminder, getReminder,
} = await import('../src/db/queries.js');

function insertCapture(db: ReturnType<typeof createDatabase>, id: string, content: string, createdAt = Date.now()): void {
  db.prepare('INSERT INTO captures (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, content, createdAt, createdAt);
  setCaptureTags(db, id, []);
  syncCaptureFts(db, id);
}

test('fresh v2 schema seeds fields, rules, templates and editable settings — no Jev tables', () => {
  const db = createDatabase(':memory:');
  const columns = (db.prepare('PRAGMA table_info(captures)').all() as Array<{ name: string }>).map((row) => row.name);
  for (const column of ['triaged', 'expires_at', 'expire_action', 'deleted_at']) assert.ok(columns.includes(column), column);
  for (const forbidden of ['jev_mode', 'energy', 'embedding']) assert.equal(getSetting(db, forbidden, ''), '');
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
  for (const removed of ['jev_usage', 'decision_heads', 'capture_decisions']) assert.equal(tables.includes(removed), false, removed);
  assert.deepEqual(listFields(db).map((field) => `${field.name}:${field.alias}`), ['leverage:L', 'actionable:act', 'falsifiable:fals', 'domain:dom']);
  assert.equal(listFields(db)[0]?.fieldType, 'score');
  assert.deepEqual(listRules(db).map((rule) => rule.id), ['rule-otp', 'rule-url-router', 'rule-question', 'rule-actionable', 'rule-stub']);
  assert.equal(listTemplates(db).length, 6);
  assert.equal(listTemplates(db).filter((template) => template.isDefault).length, 1);
  const settings = getSetting(db, 'digest_time', '');
  assert.equal(settings, '07:55');
  assert.equal(getSetting(db, 'owner_timezone', ''), 'Asia/Tehran');
  assert.equal(getSetting(db, 'inline_syntax_enabled', ''), 'true');
  assert.deepEqual(listSavedViews(db).map((view) => view.name), ['High Leverage', 'Actionable Open', 'Unread Links']);
  db.close();
});

test('v1 database migrates idempotently, preserving captures, tags, edges, reminders, views and auth tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blinko-v1-'));
  const path = join(dir, 'app.db');
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE captures (id TEXT PRIMARY KEY, content TEXT NOT NULL, bucket TEXT NOT NULL DEFAULT 'idea',
      status TEXT NOT NULL DEFAULT 'active', is_pinned INTEGER DEFAULT 0, capture_mode TEXT DEFAULT 'auto',
      source_url TEXT, url_title TEXT, url_excerpt TEXT, meta TEXT DEFAULT '{}', created_at INTEGER, updated_at INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
    CREATE TABLE capture_tags (capture_id TEXT, tag_id INTEGER, PRIMARY KEY (capture_id, tag_id));
    CREATE TABLE capture_edges (source_id TEXT, target_id TEXT, relation TEXT, note TEXT, created_at INTEGER, PRIMARY KEY (source_id, target_id, relation));
    CREATE TABLE reminders (capture_id TEXT PRIMARY KEY, due_at INTEGER, snooze_count INTEGER DEFAULT 0,
      state TEXT DEFAULT 'pending', last_notified_at INTEGER);
    CREATE TABLE decision_heads (id TEXT PRIMARY KEY, name TEXT UNIQUE, primitive TEXT, instructions TEXT, config_json TEXT,
      entropy_threshold REAL DEFAULT 0.55, active INTEGER DEFAULT 1, is_system INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, created_at INTEGER);
    CREATE TABLE capture_decisions (capture_id TEXT, head_id TEXT, value_text TEXT, value_num REAL, probs_json TEXT,
      confidence REAL, entropy REAL, source TEXT, model_version TEXT, latency_ms INTEGER, updated_at INTEGER, PRIMARY KEY (capture_id, head_id));
    CREATE TABLE jev_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_reason TEXT, model_version TEXT, heads_json TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, latency_ms INTEGER, created_at INTEGER);
    CREATE TABLE saved_views (id TEXT PRIMARY KEY, name TEXT, query TEXT, sort TEXT DEFAULT 'recent', sort_order INTEGER DEFAULT 0, created_at INTEGER);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
    CREATE TABLE auth_tokens (token_hash TEXT PRIMARY KEY, short_code_hash TEXT, kind TEXT, expires_at INTEGER, used INTEGER DEFAULT 0, created_at INTEGER);
  `);
  legacy.prepare('INSERT INTO captures (id, content, capture_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('old-manual', 'legacy #manual note', 'manual', 1000, 2000);
  legacy.prepare('INSERT INTO captures (id, content, capture_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('old-auto', 'legacy auto note', 'auto', 1000, 2000);
  legacy.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(1, 'legacy');
  legacy.prepare('INSERT INTO capture_tags VALUES (?, ?)').run('old-manual', 1);
  legacy.prepare('INSERT INTO capture_edges VALUES (?, ?, ?, ?, ?)').run('old-auto', 'old-manual', 'refines', 'migrated', 1000);
  legacy.prepare('INSERT INTO reminders VALUES (?, ?, ?, ?, ?)').run('old-auto', 9999999999999, 0, 'pending', null);
  legacy.prepare('INSERT INTO decision_heads (id, name, primitive, instructions, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('head-leverage', 'leverage', 'score', 'Leverage', '{"min":0,"max":3}', 1000);
  legacy.prepare('INSERT INTO decision_heads (id, name, primitive, instructions, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('head-bucket', 'bucket', 'choice', 'Bucket', '{}', 1000);
  legacy.prepare('INSERT INTO capture_decisions (capture_id, head_id, value_text, value_num, probs_json, confidence, entropy, source, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('old-manual', 'head-leverage', '3', 3, '{}', 1, 0, 'human', 2000);
  legacy.prepare('INSERT INTO saved_views (id, name, query, created_at) VALUES (?,?,?,?)').run('v1', 'Old view', 'b:idea', 1000);
  legacy.prepare('INSERT INTO auth_tokens (token_hash, kind, expires_at, created_at) VALUES (?,?,?,?)').run('hash', 'session', 9999999999999, 1000);
  legacy.close();

  const db = createDatabase(path);
  runMigrations(db);
  assert.equal((db.prepare('SELECT content FROM captures WHERE id = ?').get('old-manual') as { content: string }).content, 'legacy #manual note');
  assert.equal((db.prepare('SELECT triaged FROM captures WHERE id = ?').get('old-manual') as { triaged: number }).triaged, 1);
  assert.equal((db.prepare('SELECT triaged FROM captures WHERE id = ?').get('old-auto') as { triaged: number }).triaged, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM capture_tags').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM capture_edges').get() as { n: number }).n, 1);
  assert.equal(getReminder(db, 'old-auto')?.dueAt, 9999999999999);
  assert.equal(db.prepare('SELECT recurrence FROM reminders WHERE capture_id = ?').get('old-auto') !== undefined, true);
  assert.equal((db.prepare('SELECT name FROM saved_views WHERE id = ?').get('v1') as { name: string }).name, 'Old view');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get() as { n: number }).n, 1);
  assert.equal(getField(db, 'leverage')?.alias, 'L');
  const migrated = db.prepare('SELECT value_num, source, locked FROM capture_fields').get() as { value_num: number; source: string; locked: number };
  assert.equal(migrated.value_num, 3);
  assert.equal(migrated.source, 'human');
  assert.equal(migrated.locked, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM capture_fields WHERE field_id = 'head-bucket'").get() as { n: number }).n, 0);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
  assert.equal(tables.includes('jev_usage'), false);
  assert.equal(tables.includes('decision_heads'), false);
  db.close();

  const again = createDatabase(path);
  assert.equal(listFields(again).length, 4);
  assert.equal(listRules(again).length, 5);
  assert.equal(listTemplates(again).length, 6);
  assert.equal((again.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n, 2);
  again.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Persian normalization, Unicode hashtags and bm25 relevance ordering', () => {
  const db = createDatabase(':memory:');
  assert.equal(normalizeSearchText('مدرسة'), normalizeSearchText('مدرسه'));
  assert.equal(normalizeSearchText('مدی\u200cتیشن'), normalizeSearchText('مدیتیشن'));
  assert.equal(normalizeSearchText('کد ۴۲'), normalizeSearchText('کد 42'));
  const now = Date.now();
  insertCapture(db, 'persian', 'مدیتیشن و تفکر #انرژی', now);
  insertCapture(db, 'arabic-variant', 'مدیتیشن و تفکر #انرژی', now - 1000);
  setCaptureTags(db, 'persian', ['انرژی']);
  setCaptureTags(db, 'arabic-variant', ['انرژی']);
  syncCaptureFts(db, 'persian');
  syncCaptureFts(db, 'arabic-variant');
  insertCapture(db, 'spam', 'needle', now - 2000);
  insertCapture(db, 'relevant', 'needle needle needle needle', now - 3000);
  const persianHits = db.prepare('SELECT capture_id FROM captures_fts WHERE captures_fts MATCH ?').all('"مدیتیشن"*') as Array<{ capture_id: string }>;
  assert.deepEqual(persianHits.map((row) => row.capture_id).sort(), ['arabic-variant', 'persian']);
  const ranked = listCaptures(db, { q: 'needle', status: 'all' });
  assert.equal(ranked.captures[0]?.id, 'relevant');
  assert.ok(ranked.captures[0]?.snippet?.includes('<mark>needle</mark>'));
  db.close();
});

test('Query DSL supports triage, trash, length, age, field and relevance tokens with correct param order', () => {
  const parsed = parseSearchQuery('b:idea -b:noise #تگ -is:triaged is:trash has:ttl has:fields len<25 age>14d leverage>=2 sort:recent');
  assert.deepEqual(parsed.buckets.include, ['idea']);
  assert.deepEqual(parsed.buckets.exclude, ['noise']);
  assert.deepEqual(parsed.tags.include, ['تگ']);
  assert.equal(parsed.triaged, false);
  assert.equal(parsed.trash, true);
  assert.deepEqual(parsed.has.include, ['ttl', 'fields']);
  assert.deepEqual(parsed.length, [{ op: '<', value: 25 }]);
  assert.equal(parsed.age[0]?.ms, 14 * 86_400_000);
  assert.ok(parsed.fieldFilters.some((filter) => filter.field === 'leverage' && filter.op === '>=' && filter.value === '2'));

  const db = createDatabase(':memory:');
  const now = Date.now();
  insertCapture(db, 'a', 'short', now - 20 * 86_400_000);
  insertCapture(db, 'b', 'a much longer capture with words', now);
  const leverage = getField(db, 'leverage')!;
  upsertFieldValue(db, 'b', leverage.id, { valueText: '3', valueNum: 3, source: 'human', locked: true });
  assert.deepEqual(listCaptures(db, { q: 'len<10', status: 'all' }).captures.map((capture) => capture.id), ['a']);
  assert.deepEqual(listCaptures(db, { q: 'age>14d', status: 'all' }).captures.map((capture) => capture.id), ['a']);
  assert.deepEqual(listCaptures(db, { q: 'leverage>=2 sort:recent', status: 'all' }).captures.map((capture) => capture.id), ['b']);
  assert.deepEqual(listCaptures(db, { q: 'has:fields', status: 'all' }).captures.map((capture) => capture.id), ['b']);
  assert.deepEqual(listCaptures(db, { q: 'text', status: 'all', sort: 'field:leverage' }).captures.length, 0);
  db.close();
});

test('reminders keep recurrence through updates and settings are fully writable', () => {
  const db = createDatabase(':memory:');
  insertCapture(db, 'r', 'recurring reminder');
  upsertReminder(db, 'r', { dueAt: Date.now() + 60_000, recurrence: 'daily@08:00' });
  assert.equal(getReminder(db, 'r')?.recurrence, 'daily@08:00');
  upsertReminder(db, 'r', { dueAt: Date.now() + 120_000, state: 'pending', keepRecurrence: true });
  assert.equal(getReminder(db, 'r')?.recurrence, 'daily@08:00');
  db.close();
});
