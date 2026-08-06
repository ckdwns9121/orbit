ALTER TABLE work_items ADD COLUMN target_at TEXT;
ALTER TABLE work_items ADD COLUMN reminder_sent_at TEXT;

CREATE INDEX IF NOT EXISTS work_items_pending_reminders
  ON work_items(target_at, reminder_sent_at, status)
  WHERE target_at IS NOT NULL AND reminder_sent_at IS NULL AND status <> 'done';
