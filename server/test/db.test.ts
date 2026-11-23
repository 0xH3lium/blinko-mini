import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';

const { createDatabase } = await import('../src/db/client.js');
const {
  getSetting,
  listHeads,
  listSavedViews,
  listCaptures,
  parseSearchQuery,
  setCaptureTags,
  syncCaptureFts,
  upsertDecision,
} = await import('../src/db/queries.js');

function insertCapture(
  db: ReturnType<typeof createDatabase>,
  id: string,
  content: string,
  overrides: { bucket?: string; createdAt?: number; sourceUrl?: string | null } = {},
): void {
  const now = overrides.createdAt ?? Date.now();
  db.prepare(
    `INSERT INTO captures (id, content, bucket, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, content, overrides.bucket ?? 'idea', overrides.sourceUrl ?? null, now, now);
  setCaptureTags(db, id, []);
  syncCaptureFts(db, id);
}

test('schema is clean and seeds exactly the new heads, settings, and views', () => {
  const db = createDatabase(':memory:');
  const columns = db.prepare('PRAGMA table_info(captures)').all() as Array<{ name: string }>;
  const names = columns.map((column) => column.name);
  assert.deepEqual(names, [
    'id', 'content', 'bucket', 'status', 'is_pinned', 'capture_mode', 'source_url',
    'url_title', 'url_excerpt', 'meta', 'created_at', 'updated_at',
  ]);
  for (const forbidden of ['energy', 'decay' + '_lambda', 'reson' + 'ance_count', 'half_life', 'embedding', 'sim' + 'hash']) {
    assert.equal(names.includes(forbidden), false, `${forbidden} must not exist`);
  }
  const heads = listHeads(db);
  assert.deepEqual(heads.map((head) => head.name), ['bucket', 'leverage', 'actionable', 'falsifiable']);
  assert.deepEqual(heads.map((head) => head.isSystem), [true, true, false, false]);
  assert.equal(getSetting(db, 'jev_mode', ''), 'auto');
  const settings = db.prepare('SELECT key FROM app_settings').all() as Array<{ key: string }>;
  assert.deepEqual(settings.map((row) => row.key), ['jev_mode']);
  assert.deepEqual(
    listSavedViews(db).map((view) => `${view.name}:${view.query}`),
    [
      'High Leverage:leverage>=2 status:active',
      'Actionable Open:actionable:yes status:active',
      'Unread Links:b:reference has:url status:active',
    ],
  );
  db.close();
});

test('FTS5 syncs tags and URL metadata, ranks with bm25 and returns snippets', () => {
  const db = createDatabase(':memory:');
  const now = Date.now();
  insertCapture(db, 'a', 'needle in payload', { createdAt: now });
  insertCapture(db, 'b', 'needle needle needle in title', { createdAt: now - 1000 });
  setCaptureTags(db, 'a', ['needle-tag']);
  syncCaptureFts(db, 'a');
  db.prepare('UPDATE captures SET url_title = ? WHERE id = ?').run('needle headline', 'b');
  syncCaptureFts(db, 'b');

  const byTag = db.prepare('SELECT capture_id FROM captures_fts WHERE tags_text MATCH ?').all('needle*') as Array<{ capture_id: string }>;
  assert.deepEqual(byTag.map((row) => row.capture_id), ['a']);
  const byTitle = db.prepare('SELECT capture_id FROM captures_fts WHERE url_title MATCH ?').all('headline*') as Array<{ capture_id: string }>;
  assert.deepEqual(byTitle.map((row) => row.capture_id), ['b']);

  const ranked = db
    .prepare('SELECT capture_id, bm25(captures_fts, 10.0, 6.0, 5.0, 2.0) AS rank FROM captures_fts WHERE captures_fts MATCH ? ORDER BY rank')
    .all('needle*') as Array<{ capture_id: string }>;
  assert.equal(ranked[0]?.capture_id, 'b');

  const page = listCaptures(db, { q: 'needle', status: 'all' });
  assert.equal(page.total, 2);
  assert.ok(page.captures.some((capture) => capture.snippet?.includes('<mark>needle</mark>')));

  db.prepare('DELETE FROM captures WHERE id = ?').run('a');
  db.prepare('DELETE FROM captures_fts WHERE capture_id = ?').run('a');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM captures_fts WHERE capture_id = ?').get('a') as { count: number }).count, 0);
  db.close();
});

test('capture_decisions upserts to one authoritative row per (capture, head)', () => {
  const db = createDatabase(':memory:');
  insertCapture(db, 'c1', 'a decision target');
  const input = {
    captureId: 'c1',
    headId: 'head-leverage',
    valueText: '2',
    valueNum: 2,
    probs: { 2: 1 },
    confidence: 1,
    entropy: 0,
    source: 'jev' as const,
  };
  upsertDecision(db, input);
  upsertDecision(db, { ...input, valueNum: 3, valueText: '3', probs: { 3: 1 }, source: 'human', entropy: 0 });
  const rows = db.prepare('SELECT * FROM capture_decisions').all() as Array<{ value_num: number; source: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.value_num, 3);
  assert.equal(rows[0]?.source, 'human');
  db.close();
});

test('Query DSL parses buckets, tags, heads, due windows and exclusions', () => {
  const parsed = parseSearchQuery('b:idea -b:noise #work -#draft leverage>=2 actionable:yes is:pinned mode:manual due:overdue entropy>0.55 alpha');
  assert.deepEqual(parsed.buckets.include, ['idea']);
  assert.deepEqual(parsed.buckets.exclude, ['noise']);
  assert.deepEqual(parsed.tags, { include: ['work'], exclude: ['draft'] });
  assert.ok(parsed.headFilters.some((filter) => filter.head === 'leverage' && filter.op === '>=' && filter.value === '2'));
  assert.ok(parsed.headFilters.some((filter) => filter.head === 'actionable' && filter.op === ':' && filter.value === 'yes'));
  assert.ok(parsed.headFilters.some((filter) => filter.head === 'entropy' && filter.op === '>' && filter.value === '0.55'));
  assert.equal(parsed.pinned, true);
  assert.equal(parsed.mode, 'manual');
  assert.deepEqual(parsed.due, ['overdue']);
  assert.equal(parsed.text, 'alpha');
});

test('SQL head and entropy sorting happens before pagination', () => {
  const db = createDatabase(':memory:');
  for (const [id, createdAt] of [['a', 1], ['b', 2], ['c', 3]] as const) insertCapture(db, id, `capture ${id}`, { createdAt });
  upsertDecision(db, { captureId: 'a', headId: 'head-leverage', valueText: '1', valueNum: 1, probs: {}, confidence: 1, entropy: 0.1, source: 'jev' });
  upsertDecision(db, { captureId: 'b', headId: 'head-leverage', valueText: '3', valueNum: 3, probs: {}, confidence: 1, entropy: 0.9, source: 'jev' });
  upsertDecision(db, { captureId: 'c', headId: 'head-leverage', valueText: '2', valueNum: 2, probs: {}, confidence: 1, entropy: 0.5, source: 'jev' });

  const asc = listCaptures(db, { status: 'all', sort: 'head:leverage', order: 'asc', limit: 2 });
  assert.deepEqual(asc.captures.map((capture) => capture.id), ['a', 'c']);
  const desc = listCaptures(db, { status: 'all', sort: 'head:leverage', order: 'desc', limit: 2 });
  assert.deepEqual(desc.captures.map((capture) => capture.id), ['b', 'c']);
  const entropy = listCaptures(db, { status: 'all', sort: 'entropy', order: 'desc' });
  assert.deepEqual(entropy.captures.map((capture) => capture.id), ['b', 'c', 'a']);
  const filtered = listCaptures(db, { q: 'leverage>=2 -b:noise', status: 'all' });
  assert.deepEqual(filtered.captures.map((capture) => capture.id).sort(), ['b', 'c']);
  db.close();
});
