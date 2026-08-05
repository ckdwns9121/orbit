CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'local',
  external_id TEXT,
  external_url TEXT,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS calendar_events_time_range
  ON calendar_events(start_at, end_at);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_external_source
  ON calendar_events(source, external_id)
  WHERE external_id IS NOT NULL;
