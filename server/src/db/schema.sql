CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'idea'
    CHECK (bucket IN ('idea','memory','reminder','question','reference','noise')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','resolved','archived')),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  capture_mode TEXT NOT NULL DEFAULT 'auto' CHECK (capture_mode IN ('auto','manual')),
  triaged INTEGER NOT NULL DEFAULT 0 CHECK (triaged IN (0, 1)),
  source_url TEXT,
  url_title TEXT,
  url_excerpt TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER,
  expire_action TEXT NOT NULL DEFAULT 'archive' CHECK (expire_action IN ('archive','trash','delete')),
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_status_created ON captures (status, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_bucket_status ON captures (bucket, status, created_at DESC);

-- Multi-column FTS5 synced explicitly by the service layer. Text is normalized before indexing.
CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
  capture_id UNINDEXED,
  content,
  tags_text,
  url_title,
  url_excerpt,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_tags (
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (capture_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_tags_tag_id ON capture_tags (tag_id);

CREATE TABLE IF NOT EXISTS telegram_messages (
  tg_message_id INTEGER PRIMARY KEY,
  tg_chat_id INTEGER NOT NULL,
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('input','triage','reminder')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_capture ON telegram_messages (capture_id);

CREATE TABLE IF NOT EXISTS capture_edges (
  source_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('reply','related','refines','supports','blocks','answers')),
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_capture_edges_target ON capture_edges (target_id);

CREATE TABLE IF NOT EXISTS reminders (
  capture_id TEXT PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL,
  snooze_count INTEGER NOT NULL DEFAULT 0,
  recurrence TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','notified','done','killed')),
  last_notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (state, due_at);

CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  alias TEXT UNIQUE,
  field_type TEXT NOT NULL CHECK (field_type IN ('score','choice','boolean','text')),
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  show_in_stream INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_fields (
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  value_num REAL,
  source TEXT NOT NULL CHECK (source IN ('rule','syntax','human','patch')),
  locked INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (capture_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_fields_value ON capture_fields (field_id, value_num);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  stop_on_match INTEGER NOT NULL DEFAULT 0,
  conditions_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS extractor_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  output_mode TEXT NOT NULL DEFAULT 'clipboard' CHECK (output_mode IN ('clipboard','download_md','download_json','obsidian_uri')),
  preamble TEXT NOT NULL,
  item_template TEXT NOT NULL,
  footer TEXT NOT NULL DEFAULT '',
  include_neighbors INTEGER NOT NULL DEFAULT 1,
  exclude_noise INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  sort TEXT NOT NULL DEFAULT 'recent',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  short_code_hash TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('magic_link','session')),
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_code ON auth_tokens (short_code_hash);
