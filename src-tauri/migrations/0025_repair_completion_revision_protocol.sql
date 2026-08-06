DROP TRIGGER IF EXISTS completion_record_apply;
DROP TRIGGER IF EXISTS work_items_transition_guard;
DROP TRIGGER IF EXISTS work_items_transition_event;
DROP INDEX IF EXISTS completion_records_one_active;
DROP INDEX IF EXISTS completion_records_history;

ALTER TABLE completion_records RENAME TO completion_records_pre_revision;

CREATE TABLE completion_records (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  result_summary TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '',
  remaining_risk TEXT NOT NULL DEFAULT '',
  retrospective TEXT NOT NULL DEFAULT '',
  jira_project_key TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL DEFAULT 'user' CHECK (provenance IN ('user', 'legacy-inferred')),
  base_work_item_revision INTEGER NOT NULL CHECK (base_work_item_revision >= 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'superseded')),
  superseded_at TEXT,
  completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO completion_records(
  id, work_item_id, result_summary, decisions, remaining_risk, retrospective,
  jira_project_key, evidence_json, provenance, base_work_item_revision,
  state, superseded_at, completed_at, created_at
)
SELECT c.id, c.work_item_id, c.result_summary, c.decisions, c.remaining_risk,
       c.retrospective, c.jira_project_key, c.evidence_json, c.provenance,
       CASE
         WHEN c.provenance = 'user' AND c.state = 'active' AND w.status = 'done'
           THEN max(w.revision - 1, 0)
         ELSE max(w.revision, 0)
       END,
       c.state, c.superseded_at, c.completed_at, c.created_at
FROM completion_records_pre_revision c
JOIN work_items w ON w.id = c.work_item_id;

DROP TABLE completion_records_pre_revision;

CREATE UNIQUE INDEX completion_records_one_active
  ON completion_records(work_item_id) WHERE state = 'active';
CREATE INDEX completion_records_history
  ON completion_records(completed_at DESC, jira_project_key, work_item_id);

CREATE TRIGGER work_items_transition_guard
BEFORE UPDATE OF status, checkpoint, next_action, blocked_reason, resume_condition, next_review_at, revision
ON work_items
FOR EACH ROW
WHEN NEW.status IS NOT OLD.status
  OR NEW.checkpoint IS NOT OLD.checkpoint
  OR NEW.next_action IS NOT OLD.next_action
  OR NEW.blocked_reason IS NOT OLD.blocked_reason
  OR NEW.resume_condition IS NOT OLD.resume_condition
  OR NEW.next_review_at IS NOT OLD.next_review_at
BEGIN
  SELECT CASE WHEN NEW.revision <> OLD.revision + 1
    THEN RAISE(ABORT, 'work_item_revision_conflict') END;
  SELECT CASE WHEN NEW.status = 'blocked'
      AND (length(trim(COALESCE(NEW.blocked_reason, ''))) = 0
        OR length(trim(COALESCE(NEW.resume_condition, ''))) = 0)
    THEN RAISE(ABORT, 'blocked_requires_reason_and_resume_condition') END;
  SELECT CASE WHEN OLD.status = 'focus' AND NEW.status <> 'focus' AND NEW.status <> 'done'
      AND (length(trim(COALESCE(NEW.checkpoint, ''))) = 0
        OR length(trim(COALESCE(NEW.next_action, ''))) = 0)
    THEN RAISE(ABORT, 'focus_release_requires_checkpoint_and_next_action') END;
  SELECT CASE WHEN OLD.status = 'focus' AND NEW.status <> 'focus' AND NEW.status <> 'done'
      AND NOT EXISTS (
        SELECT 1 FROM work_focus_transition_commands c
        WHERE c.correlation_id = NEW.transition_correlation_id AND c.status = 'pending'
      )
    THEN RAISE(ABORT, 'focus_release_requires_command') END;
  SELECT CASE WHEN NEW.status = 'done' AND OLD.status <> 'done'
      AND NOT EXISTS (
        SELECT 1 FROM completion_records c
        WHERE c.work_item_id = NEW.id AND c.state = 'active'
      )
    THEN RAISE(ABORT, 'done_requires_completion_record') END;
  SELECT CASE WHEN NEW.status = 'focus' AND OLD.status <> 'focus'
      AND NOT EXISTS (
        SELECT 1 FROM work_focus_transition_commands c
        WHERE c.correlation_id = NEW.transition_correlation_id AND c.status = 'pending'
      )
    THEN RAISE(ABORT, 'focus_requires_command') END;
END;

CREATE TRIGGER work_items_transition_event
AFTER UPDATE OF status, checkpoint, next_action, blocked_reason, resume_condition, revision
ON work_items
FOR EACH ROW
WHEN NEW.revision = OLD.revision + 1
BEGIN
  INSERT INTO activity_events(id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at)
  VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    CASE
      WHEN NEW.status = 'done' AND OLD.status <> 'done' THEN 'task_completed'
      WHEN NEW.status = 'focus' AND OLD.status <> 'focus' THEN 'task_resumed'
      WHEN NEW.status = 'blocked' AND OLD.status <> 'blocked' THEN 'task_blocked'
      WHEN OLD.status = 'blocked' AND NEW.status <> 'blocked' THEN 'blocked_resolved'
      WHEN OLD.status = 'focus' AND NEW.status <> 'focus' THEN 'pause_saved'
      WHEN NEW.checkpoint IS NOT OLD.checkpoint THEN 'checkpoint_updated'
      WHEN NEW.next_action IS NOT OLD.next_action THEN 'next_action_updated'
      ELSE 'status_advanced'
    END,
    COALESCE(NEW.transition_correlation_id, lower(hex(randomblob(16)))),
    'orbit',
    json_object('fromStatus', OLD.status, 'toStatus', NEW.status, 'revision', NEW.revision),
    NEW.updated_at
  );

  UPDATE status_suggestions
  SET state = CASE WHEN id = NEW.transition_correlation_id THEN 'applied' ELSE 'stale' END,
      resolved_at = NEW.updated_at
  WHERE work_item_id = NEW.id AND state = 'pending'
    AND base_work_item_revision < NEW.revision;

  UPDATE completion_records
  SET state = 'superseded', superseded_at = NEW.updated_at
  WHERE work_item_id = NEW.id AND state = 'active'
    AND OLD.status = 'done' AND NEW.status <> 'done';
END;

CREATE TRIGGER completion_record_apply
AFTER INSERT ON completion_records
FOR EACH ROW
WHEN NEW.state = 'active' AND NEW.provenance = 'user'
BEGIN
  SELECT CASE WHEN NEW.base_work_item_revision <> (
    SELECT revision FROM work_items WHERE id = NEW.work_item_id
  ) THEN RAISE(ABORT, 'work_item_revision_conflict') END;

  UPDATE work_focus_slot
  SET work_item_id = NULL, revision = revision + 1, updated_at = NEW.completed_at
  WHERE slot = 1 AND work_item_id = NEW.work_item_id;

  UPDATE work_items
  SET status = 'done', completed_at = NEW.completed_at,
      transition_correlation_id = NEW.id,
      revision = revision + 1, updated_at = NEW.completed_at
  WHERE id = NEW.work_item_id;
END;
