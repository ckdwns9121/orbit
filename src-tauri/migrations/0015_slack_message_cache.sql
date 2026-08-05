CREATE TABLE IF NOT EXISTS slack_messages (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  permalink TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_searches (
  query_key TEXT PRIMARY KEY NOT NULL,
  query TEXT NOT NULL,
  searched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_search_results (
  query_key TEXT NOT NULL REFERENCES slack_searches(query_key) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES slack_messages(id) ON DELETE CASCADE,
  PRIMARY KEY (query_key, message_id)
);

CREATE INDEX IF NOT EXISTS slack_messages_timestamp
  ON slack_messages(message_ts DESC);
