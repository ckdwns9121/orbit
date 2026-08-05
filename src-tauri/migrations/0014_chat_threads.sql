CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  response_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_created
  ON chat_messages(thread_id, created_at ASC);
