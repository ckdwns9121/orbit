-- Repair databases created by early development builds of migration 0021.
-- Rebuilding this receipt table is safe: consumed rows contain no continuity
-- payload and no other table references it.
DROP TRIGGER IF EXISTS work_focus_command_apply;
DROP INDEX IF EXISTS work_focus_commands_status_time;
DROP INDEX IF EXISTS work_focus_commands_current;
DROP INDEX IF EXISTS work_focus_commands_requested;

ALTER TABLE work_focus_transition_commands RENAME TO work_focus_transition_commands_legacy;

CREATE TABLE work_focus_transition_commands (
  id TEXT PRIMARY KEY NOT NULL,
  correlation_id TEXT NOT NULL UNIQUE,
  current_work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  requested_work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  expected_slot_revision INTEGER NOT NULL,
  expected_current_revision INTEGER,
  expected_requested_revision INTEGER,
  release_status TEXT CHECK (release_status IS NULL OR release_status IN ('todo', 'ai_running', 'review', 'blocked')),
  checkpoint TEXT,
  next_action TEXT,
  blocked_reason TEXT,
  resume_condition TEXT,
  next_review_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed')),
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

INSERT INTO work_focus_transition_commands(
  id, correlation_id, current_work_item_id, requested_work_item_id,
  expected_slot_revision, expected_current_revision, expected_requested_revision,
  release_status, checkpoint, next_action, blocked_reason, resume_condition,
  next_review_at, status, created_at, consumed_at
)
SELECT id, correlation_id, current_work_item_id, requested_work_item_id,
  expected_slot_revision, expected_current_revision, expected_requested_revision,
  release_status, NULL, NULL, NULL, NULL, NULL, status, created_at, consumed_at
FROM work_focus_transition_commands_legacy;

DROP TABLE work_focus_transition_commands_legacy;

CREATE INDEX work_focus_commands_status_time
  ON work_focus_transition_commands(status, created_at DESC);
CREATE INDEX work_focus_commands_current
  ON work_focus_transition_commands(current_work_item_id, created_at DESC);
CREATE INDEX work_focus_commands_requested
  ON work_focus_transition_commands(requested_work_item_id, created_at DESC);

CREATE TRIGGER work_focus_command_apply
AFTER INSERT ON work_focus_transition_commands
FOR EACH ROW
WHEN NEW.status = 'pending'
BEGIN
  SELECT CASE WHEN NEW.expected_slot_revision <> (SELECT revision FROM work_focus_slot WHERE slot = 1)
    THEN RAISE(ABORT, 'focus_slot_revision_conflict') END;
  SELECT CASE WHEN NEW.current_work_item_id IS NOT (SELECT work_item_id FROM work_focus_slot WHERE slot = 1)
    THEN RAISE(ABORT, 'focus_slot_task_conflict') END;
  SELECT CASE WHEN NEW.current_work_item_id IS NOT NULL
      AND NEW.expected_current_revision <> (SELECT revision FROM work_items WHERE id = NEW.current_work_item_id)
    THEN RAISE(ABORT, 'current_work_item_revision_conflict') END;
  SELECT CASE WHEN NEW.requested_work_item_id IS NOT NULL
      AND NEW.expected_requested_revision <> (SELECT revision FROM work_items WHERE id = NEW.requested_work_item_id)
    THEN RAISE(ABORT, 'requested_work_item_revision_conflict') END;
  SELECT CASE WHEN NEW.current_work_item_id IS NEW.requested_work_item_id AND NEW.current_work_item_id IS NOT NULL
    THEN RAISE(ABORT, 'focus_command_same_task') END;
  SELECT CASE WHEN NEW.current_work_item_id IS NOT NULL
      AND (NEW.release_status IS NULL
        OR length(trim(COALESCE(NEW.checkpoint, ''))) = 0
        OR length(trim(COALESCE(NEW.next_action, ''))) = 0)
    THEN RAISE(ABORT, 'focus_release_requires_checkpoint_and_next_action') END;
  SELECT CASE WHEN NEW.release_status = 'blocked'
      AND (length(trim(COALESCE(NEW.blocked_reason, ''))) = 0
        OR length(trim(COALESCE(NEW.resume_condition, ''))) = 0)
    THEN RAISE(ABORT, 'blocked_requires_reason_and_resume_condition') END;

  UPDATE work_items
  SET status = NEW.release_status,
      checkpoint = trim(NEW.checkpoint),
      next_action = trim(NEW.next_action),
      blocked_reason = CASE WHEN NEW.release_status = 'blocked' THEN trim(NEW.blocked_reason) ELSE NULL END,
      resume_condition = CASE WHEN NEW.release_status = 'blocked' THEN trim(NEW.resume_condition) ELSE NULL END,
      next_review_at = CASE WHEN NEW.release_status = 'blocked' THEN NEW.next_review_at ELSE NULL END,
      paused_at = NEW.created_at,
      transition_correlation_id = NEW.correlation_id,
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE id = NEW.current_work_item_id;

  UPDATE work_items
  SET status = 'focus', completed_at = NULL, blocked_reason = NULL,
      resume_condition = NULL, next_review_at = NULL,
      last_focused_at = NEW.created_at,
      transition_correlation_id = NEW.correlation_id,
      revision = revision + 1, updated_at = NEW.created_at
  WHERE id = NEW.requested_work_item_id;

  UPDATE work_focus_slot
  SET work_item_id = NEW.requested_work_item_id,
      revision = revision + 1,
      updated_at = NEW.created_at
  WHERE slot = 1;

  UPDATE work_focus_transition_commands
  SET status = 'consumed', consumed_at = NEW.created_at,
      checkpoint = NULL, next_action = NULL, blocked_reason = NULL,
      resume_condition = NULL, next_review_at = NULL
  WHERE id = NEW.id;
END;
