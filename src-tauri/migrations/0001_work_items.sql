CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (
    status IN ('inbox', 'todo', 'focus', 'ai_running', 'review', 'blocked', 'done')
  ),
  priority TEXT CHECK (priority IS NULL OR priority IN ('p1', 'p2', 'p3')),
  source TEXT NOT NULL DEFAULT 'local',
  external_id TEXT,
  external_url TEXT,
  goal TEXT,
  checkpoint TEXT,
  next_action TEXT,
  done_definition TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS work_items_one_focus
  ON work_items(status)
  WHERE status = 'focus';

CREATE INDEX IF NOT EXISTS work_items_status_position
  ON work_items(status, position, updated_at DESC);

CREATE INDEX IF NOT EXISTS work_items_updated_at
  ON work_items(updated_at DESC);
