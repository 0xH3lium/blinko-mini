import type Database from 'better-sqlite3';

export type ItemType = 'blink' | 'note';
export type ItemStatus = 'active' | 'archived';

export interface Item {
  id: string;
  type: ItemType;
  title: string | null;
  content: string;
  status: ItemStatus;
  isPinned: boolean;
  meta: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface ItemFilters {
  type?: ItemType;
  status?: ItemStatus;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ItemPage {
  items: Item[];
  total: number;
}

export interface TagRow {
  id: string;
  type: ItemType;
  title: string | null;
  content: string;
  status: ItemStatus;
  is_pinned: number;
  meta: string;
  created_at: number;
  updated_at: number;
}

interface TagLinkRow {
  item_id: string;
  name: string;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function tagsForItems(db: Database.Database, itemIds: string[]): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  if (itemIds.length === 0) return byItem;

  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT it.item_id, t.name
         FROM item_tags it
         JOIN tags t ON t.id = it.tag_id
        WHERE it.item_id IN (${placeholders})
        ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(...itemIds) as TagLinkRow[];

  for (const row of rows) {
    const tags = byItem.get(row.item_id) ?? [];
    tags.push(row.name);
    byItem.set(row.item_id, tags);
  }
  return byItem;
}

export function rowToItem(row: TagRow, tags: string[]): Item {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    status: row.status,
    isPinned: row.is_pinned === 1,
    meta: parseMeta(row.meta),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Converts arbitrary user input into a safe FTS5 prefix query.
 * Each token is quoted ("read"*) so operators inside the input cannot break
 * the MATCH expression. Double quotes are escaped as FTS5 expects.
 */
export function buildFtsQuery(input: string): string | null {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => /[\p{L}\p{N}_]/u.test(token))
    .map((token) => token.replaceAll('"', '""'))
    .map((token) => `"${token}"*`);

  return tokens.length > 0 ? tokens.join(' ') : null;
}

export function listItems(db: Database.Database, filters: ItemFilters): ItemPage {
  const status = filters.status ?? 'active';
  const where: string[] = ['i.status = ?'];
  const params: unknown[] = [status];
  let joins = '';

  if (filters.type) {
    where.push('i.type = ?');
    params.push(filters.type);
  }

  if (filters.tag) {
    where.push(
      `EXISTS (
        SELECT 1 FROM item_tags it
        JOIN tags t ON t.id = it.tag_id
        WHERE it.item_id = i.id AND t.name = ?
      )`,
    );
    params.push(filters.tag.trim().toLowerCase());
  }

  if (filters.q) {
    const ftsQuery = buildFtsQuery(filters.q);
    if (!ftsQuery) {
      // A search made entirely of punctuation should match nothing rather
      // than silently falling back to "return everything".
      return { items: [], total: 0 };
    }
    joins += ' JOIN items_fts ON items_fts.rowid = i.rowid';
    where.push('items_fts MATCH ?');
    params.push(ftsQuery);
  }

  const whereSql = where.join(' AND ');
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM items i ${joins} WHERE ${whereSql}`)
    .get(...params) as { count: number };

  const orderBy =
    filters.type === 'blink'
      ? 'i.is_pinned DESC, i.created_at DESC, i.rowid DESC'
      : 'i.is_pinned DESC, i.updated_at DESC, i.rowid DESC';

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const rows = db
    .prepare(
      `SELECT i.* FROM items i ${joins} WHERE ${whereSql}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as TagRow[];

  const tagMap = tagsForItems(
    db,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => rowToItem(row, tagMap.get(row.id) ?? [])),
    total: Number(countRow.count),
  };
}

export function getItemRow(db: Database.Database, id: string): TagRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as TagRow | undefined;
}

export function getItemById(
  db: Database.Database,
  id: string,
): Item | undefined {
  const row = getItemRow(db, id);
  if (!row) return undefined;
  const tags = tagsForItems(db, [id]).get(id) ?? [];
  return rowToItem(row, tags);
}

export function listTags(
  db: Database.Database,
  options: { type?: ItemType; status?: ItemStatus } = {},
): TagCount[] {
  const where = ['i.status = ?'];
  const params: unknown[] = [options.status ?? 'active'];
  if (options.type) {
    where.push('i.type = ?');
    params.push(options.type);
  }

  return db
    .prepare(
      `SELECT t.name, COUNT(DISTINCT i.id) AS count
         FROM tags t
         JOIN item_tags it ON it.tag_id = t.id
         JOIN items i ON i.id = it.item_id
        WHERE ${where.join(' AND ')}
        GROUP BY t.id, t.name
        ORDER BY count DESC, t.name COLLATE NOCASE ASC`,
    )
    .all(...params) as TagCount[];
}

export function deleteOrphanTags(db: Database.Database): void {
  db.prepare(
    `DELETE FROM tags
      WHERE NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.tag_id = tags.id)`,
  ).run();
}
