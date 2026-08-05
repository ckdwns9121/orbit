CREATE TABLE IF NOT EXISTS jira_issues (
  issue_key TEXT PRIMARY KEY NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  status_category TEXT NOT NULL,
  priority TEXT,
  project_key TEXT NOT NULL,
  project_name TEXT NOT NULL,
  due_date TEXT,
  updated_at TEXT NOT NULL,
  url TEXT NOT NULL,
  discovered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jira_issues_updated
  ON jira_issues(updated_at DESC);
