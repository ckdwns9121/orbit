CREATE TABLE IF NOT EXISTS work_item_workflows (
  work_item_id TEXT PRIMARY KEY NOT NULL,
  plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
  progress_json TEXT NOT NULL CHECK(json_valid(progress_json)),
  source_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_snapshot_json)),
  model TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS work_item_workflows_updated
  ON work_item_workflows(updated_at DESC);
