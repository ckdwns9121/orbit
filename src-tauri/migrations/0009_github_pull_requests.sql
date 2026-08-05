CREATE TABLE IF NOT EXISTS github_pull_requests (
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  repo_path TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  head_ref_name TEXT NOT NULL,
  base_ref_name TEXT NOT NULL,
  is_draft INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  author_login TEXT,
  session_match_count INTEGER NOT NULL DEFAULT 0,
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (repository, number)
);

CREATE INDEX IF NOT EXISTS github_pull_requests_updated
  ON github_pull_requests(session_match_count DESC, updated_at DESC);
