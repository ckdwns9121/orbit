ALTER TABLE ai_sessions ADD COLUMN completion_state TEXT NOT NULL DEFAULT 'active'
  CHECK (completion_state IN ('active', 'done'));

UPDATE work_items SET status = 'todo' WHERE status = 'inbox';
UPDATE work_items SET status = 'ai_running'
WHERE status IN ('focus', 'review', 'blocked');
