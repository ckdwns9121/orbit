CREATE TABLE IF NOT EXISTS chat_agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  question TEXT NOT NULL,
  model TEXT NOT NULL,
  context TEXT NOT NULL,
  conversation_json TEXT NOT NULL,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  iteration INTEGER NOT NULL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('running', 'awaiting_approval', 'completed', 'cancelled', 'failed')),
  response_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_agent_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  message_id TEXT,
  call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL CHECK(tool_name IN ('create_task', 'update_task', 'add_task_to_planner')),
  arguments_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'executing', 'approved', 'rejected', 'failed')),
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, call_id),
  FOREIGN KEY(run_id) REFERENCES chat_agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS chat_agent_runs_thread_updated ON chat_agent_runs(thread_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_agent_approvals_message_created ON chat_agent_approvals(message_id, created_at ASC);
