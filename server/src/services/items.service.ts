import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import {
  deleteOrphanTags,
  getItemById,
  getItemRow,
  listItems,
  listTags,
  type Item,
  type ItemFilters,
  type ItemPage,
  type ItemStatus,
  type ItemType,
  type TagCount,
} from '../db/queries.js';

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface CreateItemInput {
  type?: ItemType;
  title?: string | null;
  content: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface UpdateItemInput {
  type?: ItemType;
  title?: string | null;
  content?: string;
  status?: ItemStatus;
  isPinned?: boolean;
  tags?: string[];
  meta?: Record<string, unknown>;
}

const HASHTAG_PATTERN = /(?:^|\s)#([a-zA-Z0-9_-]{1,50})/g;
const VALID_TAG = /^[a-z0-9_-]{1,50}$/;

/** Extract normalized, unique #hashtags from a piece of text. */
export function extractHashtags(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag) found.add(tag);
  }
  return [...found];
}

/** Normalize user-supplied tags, dropping anything that isn't tag-safe. */
export function normalizeTags(tags: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, '').toLowerCase();
    if (VALID_TAG.test(tag)) normalized.add(tag);
  }
  return [...normalized];
}

function uniqueTags(...groups: Array<readonly string[]>): string[] {
  return [...new Set(groups.flat())];
}

function fallbackTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || 'Untitled').slice(0, 120);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializeMeta(value: unknown): string {
  if (value === undefined) return '{}';
  if (!isPlainObject(value)) {
    throw new ServiceError('meta must be a JSON object');
  }
  return JSON.stringify(value);
}

function setItemTags(db: Database.Database, itemId: string, tags: string[]): void {
  db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);

  const upsert = db.prepare(
    'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING',
  );
  const find = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare(
    'INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)',
  );

  for (const tag of tags) {
    upsert.run(tag);
    const row = find.get(tag) as { id: number } | undefined;
    if (row) link.run(itemId, row.id);
  }
}

export class ItemsService {
  constructor(private readonly db: Database.Database) {}

  list(filters: ItemFilters = {}): ItemPage {
    return listItems(this.db, filters);
  }

  get(id: string): Item | undefined {
    return getItemById(this.db, id);
  }

  tags(options: { type?: ItemType; status?: ItemStatus } = {}): TagCount[] {
    return listTags(this.db, options);
  }

  create(input: CreateItemInput): Item {
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!content) throw new ServiceError('content must be a non-empty string');

    const type: ItemType = input.type === 'note' ? 'note' : 'blink';
    if (input.type !== undefined && input.type !== 'blink' && input.type !== 'note') {
      throw new ServiceError('type must be "blink" or "note"');
    }

    let title =
      typeof input.title === 'string' && input.title.trim()
        ? input.title.trim()
        : null;
    if (type === 'note' && !title) title = fallbackTitle(content);

    const tags = uniqueTags(
      extractHashtags(content),
      normalizeTags(input.tags ?? []),
    );
    const now = Date.now();
    const id = nanoid();
    const meta = serializeMeta(input.meta);
    const createWithTags = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO items
            (id, type, title, content, status, is_pinned, meta, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
        )
        .run(id, type, title, content, meta, now, now);
      setItemTags(this.db, id, tags);
      deleteOrphanTags(this.db);
      return getItemById(this.db, id);
    });

    const item = createWithTags();
    if (!item) throw new Error('Failed to read the newly created item');
    return item;
  }

  update(id: string, input: UpdateItemInput): Item | undefined {
    const existing = getItemRow(this.db, id);
    if (!existing) return undefined;

    if (input.type !== undefined && input.type !== 'blink' && input.type !== 'note') {
      throw new ServiceError('type must be "blink" or "note"');
    }
    if (
      input.status !== undefined &&
      input.status !== 'active' &&
      input.status !== 'archived'
    ) {
      throw new ServiceError('status must be "active" or "archived"');
    }
    if (input.isPinned !== undefined && typeof input.isPinned !== 'boolean') {
      throw new ServiceError('isPinned must be a boolean');
    }

    const content =
      input.content === undefined
        ? existing.content
        : typeof input.content === 'string'
          ? input.content.trim()
          : '';
    if (!content) throw new ServiceError('content must be a non-empty string');

    const type = input.type ?? existing.type;

    let title: string | null;
    if (input.title === undefined) {
      title = existing.title;
    } else if (input.title === null) {
      title = null;
    } else if (typeof input.title !== 'string') {
      throw new ServiceError('title must be a string or null');
    } else {
      title = input.title.trim() || null;
    }
    if (type === 'note' && !title) title = fallbackTitle(content);
    if (type === 'blink' && title === '') title = null;

    const meta =
      input.meta === undefined ? existing.meta : serializeMeta(input.meta);
    const status = input.status ?? existing.status;
    const isPinned =
      input.isPinned === undefined
        ? existing.is_pinned === 1
        : input.isPinned;
    const now = Math.max(Date.now(), existing.updated_at + 1);

    const currentTags = (this.get(id)?.tags ?? []).slice();
    const extracted = extractHashtags(content);
    const tags =
      input.tags === undefined
        ? uniqueTags(extracted, currentTags)
        : uniqueTags(extracted, normalizeTags(input.tags));

    const updateTransaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE items
              SET type = ?, title = ?, content = ?, status = ?,
                  is_pinned = ?, meta = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(type, title, content, status, isPinned ? 1 : 0, meta, now, id);
      setItemTags(this.db, id, tags);
      deleteOrphanTags(this.db);
      return getItemById(this.db, id);
    });

    return updateTransaction();
  }

  remove(id: string): boolean {
    const removeTransaction = this.db.transaction(() => {
      const result = this.db.prepare('DELETE FROM items WHERE id = ?').run(id);
      if (result.changes > 0) deleteOrphanTags(this.db);
      return result.changes > 0;
    });
    return removeTransaction();
  }
}

let service: ItemsService | undefined;

export function getItemsService(): ItemsService {
  if (!service) service = new ItemsService(getDatabase());
  return service;
}
