ALTER TABLE ai_sessions ADD COLUMN custom_title TEXT;

ALTER TABLE work_item_links RENAME TO work_item_links_v5;
DROP INDEX IF EXISTS work_item_links_unique_reference;
DROP INDEX IF EXISTS work_item_links_work_item;

CREATE TABLE work_item_links (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('jira', 'github_pr', 'github_commit')),
  external_id TEXT,
  external_url TEXT,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'linked',
  last_synced_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO work_item_links (
  id, work_item_id, kind, external_id, external_url, label, status, last_synced_at, created_at
)
SELECT id, work_item_id, kind, external_id, external_url, label, 'linked', NULL, created_at
FROM work_item_links_v5;

DROP TABLE work_item_links_v5;

CREATE UNIQUE INDEX work_item_links_unique_reference
  ON work_item_links(work_item_id, kind, COALESCE(external_url, external_id));

CREATE INDEX work_item_links_work_item
  ON work_item_links(work_item_id, created_at);
