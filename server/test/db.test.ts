import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type Database from 'better-sqlite3';
import { createDatabase } from '../src/db/client.js';
import { ItemsService, extractHashtags, normalizeTags } from '../src/services/items.service.js';
import { buildFtsQuery, listItems } from '../src/db/queries.js';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function freshService(): ItemsService {
  db = createDatabase(':memory:');
  return new ItemsService(db);
}

test('FTS5 index follows inserts, updates, and deletes via triggers', () => {
  db = createDatabase(':memory:');
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, content, created_at, updated_at)
     VALUES ('fts-1', 'blink', NULL, 'alpha bravo', ?, ?)`,
  ).run(now, now);

  const search = (query: string) =>
    db!
      .prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ?')
      .all(query) as Array<{ rowid: number }>;

  assert.equal(search('"alpha"*').length, 1);

  db.prepare(
    `UPDATE items SET title = 'Charlie', content = 'delta echo', updated_at = ? WHERE id = 'fts-1'`,
  ).run(now + 1);

  assert.equal(search('"alpha"*').length, 0);
  assert.equal(search('"delta"*').length, 1);
  assert.equal(search('"charlie"*').length, 1);

  db.prepare(`DELETE FROM items WHERE id = 'fts-1'`).run();
  assert.equal(search('"delta"*').length, 0);
});

test('hashtag extraction is lowercased, deduplicated, and safe', () => {
  assert.deepEqual(
    extractHashtags('Try #JEV and #decision-model, then #jev again. #idea_2 #x'),
    ['jev', 'decision-model', 'idea_2', 'x'],
  );
  assert.deepEqual(extractHashtags('email#notatag and #bad!'), ['bad']);
  assert.deepEqual(
    normalizeTags([' #Alpha ', 'beta', 'bad tag', '#alpha', 'UPPER-CASE']),
    ['alpha', 'beta', 'upper-case'],
  );
});

test('FTS query builder neutralizes syntax characters', () => {
  assert.equal(buildFtsQuery('read book'), '"read"* "book"*');
  assert.equal(buildFtsQuery('foo-bar'), '"foo-bar"*');
  assert.equal(buildFtsQuery('"quoted"'), '"""quoted"""*');
  assert.equal(buildFtsQuery('#tag - : *'), '"#tag"*');
  assert.equal(buildFtsQuery('   '), null);
});

test('items can be created, searched, filtered, promoted, pinned, and archived', () => {
  const service = freshService();
  const blink = service.create({
    type: 'blink',
    content: 'Think about #JEV model for  priority',
    tags: ['extra-tag', 'JEV'],
  });

  assert.equal(blink.type, 'blink');
  assert.deepEqual(blink.tags, ['extra-tag', 'jev']);
  assert.equal(blink.status, 'active');
  assert.equal(blink.isPinned, false);

  const page = service.list({ type: 'blink', q: 'think' });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.id, blink.id);

  assert.equal(service.list({ q: 'priority' }).total, 1);
  assert.equal(service.list({ q: 'foo-bar:*' }).total, 0);
  assert.equal(service.list({ q: '***' }).total, 0);
  assert.equal(service.list({ tag: 'jev' }).total, 1);
  assert.equal(service.list({ tag: 'extra-tag' }).total, 1);
  assert.equal(service.list({ tag: 'missing' }).total, 0);

  const promoted = service.update(blink.id, {
    type: 'note',
    title: '',
    isPinned: true,
  });
  assert.ok(promoted);
  assert.equal(promoted.type, 'note');
  assert.equal(promoted.title, 'Think about #JEV model for  priority');
  assert.equal(promoted.isPinned, true);
  assert.ok(promoted.updatedAt > blink.updatedAt);

  const archived = service.update(blink.id, { status: 'archived' });
  assert.equal(archived?.status, 'archived');
  assert.equal(service.list({ type: 'note' }).total, 0);
  assert.equal(service.list({ type: 'note', status: 'archived' }).total, 1);

  const restored = service.update(blink.id, { status: 'active' });
  assert.equal(restored?.status, 'active');
});

test('editing tags preserves manual tags unless an explicit list is passed', () => {
  const service = freshService();
  const item = service.create({
    content: 'alpha #inline',
    tags: ['manual'],
  });

  const contentOnly = service.update(item.id, {
    content: 'beta #next',
  });
  assert.deepEqual(contentOnly?.tags, ['inline', 'manual', 'next']);

  const explicit = service.update(item.id, {
    content: contentOnly!.content,
    tags: ['only-this'],
  });
  assert.deepEqual(explicit?.tags, ['next', 'only-this']);

  const tagNames = service.tags().map((tag) => tag.name);
  assert.ok(!tagNames.includes('manual'));
  assert.ok(!tagNames.includes('inline'));
});

test('archive, pin, and delete return correct counts and clean orphan tags', () => {
  const service = freshService();
  const a = service.create({ content: 'one #shared #alpha' });
  const b = service.create({ content: 'two #shared #beta' });

  assert.deepEqual(
    service.tags().map((tag) => [tag.name, tag.count]),
    [
      ['shared', 2],
      ['alpha', 1],
      ['beta', 1],
    ],
  );

  assert.equal(service.remove(a.id), true);
  assert.equal(service.remove(a.id), false);
  assert.deepEqual(
    service.tags().map((tag) => [tag.name, tag.count]),
    [
      ['beta', 1],
      ['shared', 1],
    ],
  );

  service.remove(b.id);
  assert.deepEqual(service.tags(), []);
});

test('note titles fall back to the first line or Untitled', () => {
  const service = freshService();
  const withLine = service.create({
    type: 'note',
    content: '\n  First line title\nBody',
  });
  assert.equal(withLine.title, 'First line title');

  const blank = service.create({ type: 'note', content: '!!!' });
  assert.equal(blank.title, '!!!');

  assert.throws(() => service.create({ content: '   ' }), /non-empty/);
});

test('list ordering pins items and paginates with total', () => {
  const service = freshService();
  const older = service.create({ content: 'older' });
  const newer = service.create({ content: 'newer' });
  service.update(older.id, { isPinned: true });

  const page = service.list({ limit: 1, offset: 0 });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.id, older.id);

  const second = service.list({ limit: 1, offset: 1 });
  assert.equal(second.items[0]?.id, newer.id);
  const all = listItems(db!, { status: 'active', limit: 50 });
  assert.equal(all.total, 2);
});
