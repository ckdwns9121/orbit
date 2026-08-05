CREATE TABLE IF NOT EXISTS jira_development_cache (
  issue_key TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jira_development_cache_synced
  ON jira_development_cache(synced_at DESC);
