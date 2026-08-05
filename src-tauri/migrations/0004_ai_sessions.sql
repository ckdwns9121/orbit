CREATE TABLE IF NOT EXISTS ai_sessions (
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cwd TEXT,
  model TEXT,
  first_prompt TEXT,
  last_prompt TEXT,
  created_at TEXT,
  updated_at TEXT,
  modified_at_ms INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  acknowledged_at_ms INTEGER NOT NULL,
  linked_work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (provider, session_id)
);

CREATE INDEX IF NOT EXISTS ai_sessions_modified
  ON ai_sessions(modified_at_ms DESC);

CREATE INDEX IF NOT EXISTS ai_sessions_linked_work_item
  ON ai_sessions(linked_work_item_id);
