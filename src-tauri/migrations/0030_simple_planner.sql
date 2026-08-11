DROP TRIGGER IF EXISTS daily_plan_entries_mark_completed;
DROP TRIGGER IF EXISTS daily_plan_entries_reopen_planned;

CREATE TABLE planner_categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO planner_categories (id, name, color, sort_order, is_system, created_at, updated_at) VALUES
  ('category-work', '업무', '#2F8FBF', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('category-todo', '할일', '#D94B68', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('category-study', '공부', '#2B8C87', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE work_items ADD COLUMN category_id TEXT REFERENCES planner_categories(id) ON DELETE SET NULL;
CREATE INDEX work_items_category ON work_items(category_id, status, updated_at DESC);

CREATE TABLE planner_routines (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  category_id TEXT REFERENCES planner_categories(id) ON DELETE SET NULL,
  weekdays TEXT NOT NULL CHECK (length(weekdays) > 0),
  reminder_time TEXT CHECK (reminder_time IS NULL OR reminder_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE planner_routine_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  routine_id TEXT REFERENCES planner_routines(id) ON DELETE SET NULL,
  plan_date TEXT NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(routine_id, plan_date)
);

CREATE INDEX planner_routines_active ON planner_routines(active, category_id);
CREATE INDEX planner_routine_occurrences_date ON planner_routine_occurrences(plan_date, routine_id);
