CREATE TABLE daily_priorities (
  id TEXT PRIMARY KEY NOT NULL,
  plan_date TEXT NOT NULL CHECK (plan_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_date, work_item_id)
);

CREATE INDEX daily_priorities_date_rank ON daily_priorities(plan_date, rank, created_at);

CREATE TRIGGER daily_priorities_limit_three
BEFORE INSERT ON daily_priorities
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM daily_priorities WHERE plan_date = NEW.plan_date) >= 3
BEGIN
  SELECT RAISE(ABORT, 'daily_priority_limit_reached');
END;
