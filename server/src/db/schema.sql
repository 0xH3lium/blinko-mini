-- Blinko-OS atomic capture schema. Clean slate: no legacy notes/blinks.

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'idea' CHECK (bucket IN ('idea','memory','reminder','question','reference','noise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','sublimated')),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  energy REAL NOT NULL DEFAULT 1.0,
  decay_lambda REAL NOT NULL DEFAULT 0.05,
  resonance_count INTEGER NOT NULL DEFAULT 1,
  last_activated_at INTEGER NOT NULL,
  simhash TEXT,
  embedding BLOB,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_status_created ON captures (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_bucket_created ON captures (bucket, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
  content,
  content='captures',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS captures_ai AFTER INSERT ON captures BEGIN
  INSERT INTO captures_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS captures_ad AFTER DELETE ON captures BEGIN
  INSERT INTO captures_fts(captures_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS captures_au AFTER UPDATE ON captures BEGIN
  INSERT INTO captures_fts(captures_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO captures_fts(rowid, content) VALUES (new.rowid, new.content);
END;

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
  role TEXT NOT NULL CHECK (role IN ('input','triage','collision','reminder')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_capture ON telegram_messages (capture_id);

CREATE TABLE IF NOT EXISTS capture_edges (
  source_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('refines','reinforces','contradicts','paradox','answers','duplicate_of','reply')),
  weight REAL NOT NULL DEFAULT 1.0,
  meta TEXT NOT NULL DEFAULT '{}',
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
  auto_escalate INTEGER NOT NULL DEFAULT 1,
  local_threshold REAL NOT NULL DEFAULT 0.86,
  probe_weights BLOB,
  sample_count INTEGER NOT NULL DEFAULT 0,
  agreement_count INTEGER NOT NULL DEFAULT 0,
  eval_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  head_id TEXT NOT NULL REFERENCES decision_heads(id) ON DELETE CASCADE,
  value_text TEXT,
  value_num REAL,
  probs_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  entropy REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('deterministic','local_probe','local_knn','jev','human')),
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capture_decisions_capture ON capture_decisions (capture_id, head_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capture_decisions_entropy ON capture_decisions (entropy DESC);

CREATE TABLE IF NOT EXISTS jev_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_reason TEXT NOT NULL,
  heads_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jev_usage_created ON jev_usage (created_at);

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
