CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'idea'
    CHECK (bucket IN ('idea','memory','reminder','question','reference','noise')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','resolved','archived')),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  capture_mode TEXT NOT NULL DEFAULT 'auto' CHECK (capture_mode IN ('auto','manual')),
  source_url TEXT,
  url_title TEXT,
  url_excerpt TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_status_created ON captures (status, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_bucket_status ON captures (bucket, status, created_at DESC);

-- Multi-column FTS5 synced explicitly by service layer (content + denormalized tags + URL metadata)
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
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','notified','done','killed')),
  last_notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (state, due_at);

CREATE TABLE IF NOT EXISTS decision_heads (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  primitive TEXT NOT NULL CHECK (primitive IN ('choice','score','noul')),
  instructions TEXT NOT NULL,
  config_json TEXT NOT NULL,
  entropy_threshold REAL NOT NULL DEFAULT 0.55,
  active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Single authoritative decision per (capture_id, head_id) via UPSERT.
-- Eliminates stale high-entropy rows leaking into Review queues.
CREATE TABLE IF NOT EXISTS capture_decisions (
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  head_id TEXT NOT NULL REFERENCES decision_heads(id) ON DELETE CASCADE,
  value_text TEXT,
  value_num REAL,
  probs_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  entropy REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('deterministic','jev','human')),
  model_version TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (capture_id, head_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_decisions_head_val ON capture_decisions (head_id, value_num);
CREATE INDEX IF NOT EXISTS idx_capture_decisions_entropy ON capture_decisions (entropy DESC);

CREATE TABLE IF NOT EXISTS jev_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_reason TEXT NOT NULL,
  model_version TEXT,
  heads_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jev_usage_created ON jev_usage (created_at);

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
