import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from '../src/db/client.js';
import {
  captureFromRow,
  getCapture,
  getHeadRow,
  listHeads,
  listCaptures,
  setCaptureTags,
  type CaptureRow,
} from '../src/db/queries.js';

test('schema seeds four system heads and five default settings', () => {
  const db = createDatabase(':memory:');
  const heads = listHeads(db);
  assert.deepEqual(heads.map((head) => head.name), ['bucket', 'leverage', 'half_life', 'falsifiable']);
  assert.equal(heads.filter((head) => head.isSystem).length, 4);
  const settings = db.prepare('SELECT key FROM app_settings ORDER BY key').all() as Array<{ key: string }>;
  assert.deepEqual(settings.map((row) => row.key), [
    'bootstrap_target',
    'collision_min_cos',
    'jev_mode',
    'resonance_min_cos',
    'sublimate_energy',
  ]);
  db.close();
});

test('FTS5 triggers stay in sync with capture inserts, updates, deletes', () => {
  const db = createDatabase(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO captures (id, content, last_activated_at, created_at, updated_at)
     VALUES ('c1', 'alpha bravo', ?, ?, ?)`,
  ).run(now, now, now);
  const search = (query: string) =>
    db.prepare('SELECT rowid FROM captures_fts WHERE captures_fts MATCH ?').all(query) as Array<{ rowid: number }>;
  assert.equal(search('"alpha"*').length, 1);
  db.prepare('UPDATE captures SET content = ? WHERE id = ?').run('delta echo', 'c1');
  assert.equal(search('"alpha"*').length, 0);
  assert.equal(search('"delta"*').length, 1);
  db.prepare('DELETE FROM captures WHERE id = ?').run('c1');
  assert.equal(search('"delta"*').length, 0);
  db.close();
});

test('captures, tags, bucket counts and filters work', () => {
  const db = createDatabase(':memory:');
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO captures (id, content, bucket, energy, resonance_count, last_activated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run('a', 'one #shared', 'idea', 1.2, 3, now, now, now);
  insert.run('b', 'two #other', 'memory', 0.2, 1, now, now, now);
  setCaptureTags(db, 'a', ['shared', 'alpha']);
  setCaptureTags(db, 'b', ['other']);

  const page = listCaptures(db, { status: 'active', tag: 'shared' });
  assert.equal(page.captures.length, 1);
  assert.deepEqual(page.captures[0]?.tags, ['alpha', 'shared']);
  assert.equal(page.bucketCounts.idea, 1);

  const resonant = listCaptures(db, { status: 'active', minResonance: 2 });
  assert.equal(resonant.captures[0]?.id, 'a');

  const q = listCaptures(db, { status: 'active', q: 'two', semantic: [{ id: 'a', score: 0.4 }, { id: 'b', score: 0.9 }] });
  assert.ok(q.captures.some((capture) => capture.id === 'b'));
  db.close();
});

test('head rows round-trip primitives and config', () => {
  const db = createDatabase(':memory:');
  const bucket = getHeadRow(db, 'head-bucket');
  assert.ok(bucket);
  assert.equal(bucket!.primitive, 'choice');
  assert.ok(bucket!.config_json.includes('options'));
  const row = db.prepare('SELECT * FROM captures LIMIT 1').get() as CaptureRow | undefined;
  assert.equal(row, undefined);
  assert.equal(captureFromRow({
    id: 'x', content: 'y', bucket: 'idea', status: 'active', is_pinned: 0, energy: 1,
    decay_lambda: 0.05, resonance_count: 1, last_activated_at: 1, simhash: null,
    embedding: null, meta: '{}', created_at: 1, updated_at: 1,
  }).bucket, 'idea');
  assert.equal(getCapture(db, 'missing'), undefined);
  db.close();
});
