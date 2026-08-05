CREATE TABLE IF NOT EXISTS google_calendar_sync (
  calendar_id TEXT PRIMARY KEY,
  account_email TEXT NOT NULL,
  sync_token TEXT,
  connected_at TEXT NOT NULL,
  last_synced_at TEXT
);
