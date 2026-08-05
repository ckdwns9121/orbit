CREATE TABLE IF NOT EXISTS work_item_links (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('jira', 'github_pr')),
  external_id TEXT,
  external_url TEXT,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS work_item_links_unique_reference
  ON work_item_links(work_item_id, kind, COALESCE(external_url, external_id));

CREATE INDEX IF NOT EXISTS work_item_links_work_item
  ON work_item_links(work_item_id, created_at);

UPDATE work_items SET source = 'orbit' WHERE source = 'local';
