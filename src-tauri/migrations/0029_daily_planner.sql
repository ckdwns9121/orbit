CREATE TABLE daily_plan_entries (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL CHECK (plan_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  planned_duration_minutes INTEGER CHECK (planned_duration_minutes IS NULL OR planned_duration_minutes > 0),
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'completed', 'carried', 'skipped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_item_id, plan_date)
);

CREATE INDEX daily_plan_entries_date_order ON daily_plan_entries(plan_date, sort_order, created_at);
CREATE INDEX daily_plan_entries_work_item ON daily_plan_entries(work_item_id, plan_date DESC);

CREATE TRIGGER daily_plan_entries_sync_completed
AFTER UPDATE OF status ON work_items
FOR EACH ROW
WHEN NEW.status = 'done' AND OLD.status <> 'done'
BEGIN
  UPDATE daily_plan_entries
  SET state = 'completed',
      updated_at = COALESCE(NEW.completed_at, NEW.updated_at, OLD.updated_at)
  WHERE work_item_id = NEW.id
    AND state = 'planned';
END;

CREATE TRIGGER daily_plan_entries_sync_reopened
AFTER UPDATE OF status ON work_items
FOR EACH ROW
WHEN OLD.status = 'done' AND NEW.status <> 'done'
BEGIN
  UPDATE daily_plan_entries
  SET state = 'planned',
      updated_at = NEW.updated_at
  WHERE work_item_id = NEW.id
    AND state = 'completed';
END;

CREATE TRIGGER daily_plan_entries_mark_completed
AFTER UPDATE OF status ON work_items
WHEN NEW.status = 'done'
BEGIN
  UPDATE daily_plan_entries
  SET state = 'completed',
      updated_at = NEW.updated_at
  WHERE work_item_id = NEW.id
    AND state = 'planned';
END;

CREATE TRIGGER daily_plan_entries_reopen_planned
AFTER UPDATE OF status ON work_items
WHEN OLD.status = 'done' AND NEW.status <> 'done'
BEGIN
  UPDATE daily_plan_entries
  SET state = 'planned',
      updated_at = NEW.updated_at
  WHERE work_item_id = NEW.id
    AND state = 'completed';
END;
