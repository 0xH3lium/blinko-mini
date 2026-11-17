-- 1. Core table for Blinks and Notes
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'blink' CHECK (type IN ('blink', 'note')),
  title TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_type_status_pin_created
  ON items (type, status, is_pinned DESC, created_at DESC);

-- 2. Normalized Tags (extensible for future tag groups/decision models)
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

-- 3. Item <-> Tag Join Table
CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_item_tags_tag_id ON item_tags (tag_id);

-- 4. Full-Text Search (SQLite FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title,
  content,
  content='items',
  content_rowid='rowid'
);

-- Keep FTS5 automatically synced with items
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, content)
  VALUES (new.rowid, COALESCE(new.title, ''), new.content);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content)
  VALUES ('delete', old.rowid, COALESCE(old.title, ''), old.content);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content)
  VALUES ('delete', old.rowid, COALESCE(old.title, ''), old.content);
  INSERT INTO items_fts(rowid, title, content)
  VALUES (new.rowid, COALESCE(new.title, ''), new.content);
END;
