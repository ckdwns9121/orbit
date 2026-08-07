ALTER TABLE work_items ADD COLUMN blocked_reason TEXT;
ALTER TABLE work_items ADD COLUMN resume_condition TEXT;
ALTER TABLE work_items ADD COLUMN paused_at TEXT;
ALTER TABLE work_items ADD COLUMN last_focused_at TEXT;
ALTER TABLE work_items ADD COLUMN next_review_at TEXT;
ALTER TABLE work_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE work_items ADD COLUMN transition_correlation_id TEXT;

CREATE INDEX work_items_resume_candidates
  ON work_items(status, next_review_at, last_focused_at, paused_at, updated_at DESC);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'pause_requested', 'pause_saved', 'pause_cancelled', 'task_blocked',
    'task_resumed', 'context_opened', 'checkpoint_updated', 'next_action_updated',
    'evidence_linked', 'blocked_resolved', 'status_advanced', 'task_completed',
    'stale_surfaced', 'suggestion_created', 'suggestion_applied', 'suggestion_ignored',
    'inbox_adopted', 'inbox_linked', 'inbox_ignored', 'external_action_changed',
    'task_deleted'
  )),
  correlation_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'orbit',
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX activity_events_work_item_time
  ON activity_events(work_item_id, occurred_at DESC);
CREATE INDEX activity_events_type_time
  ON activity_events(event_type, occurred_at DESC);
CREATE INDEX activity_events_correlation
  ON activity_events(correlation_id);

CREATE TABLE source_sync_state (
  source TEXT NOT NULL CHECK (source IN ('jira', 'github', 'slack', 'calendar', 'confluence', 'ai')),
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'never', 'syncing', 'fresh', 'stale', 'partial', 'failed', 'auth-required', 'rate-limited'
  )),
  last_attempt_at TEXT,
  last_success_at TEXT,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  error_category TEXT,
  error_summary TEXT,
  retry_after_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, scope_key)
);

CREATE INDEX source_sync_state_status_age
  ON source_sync_state(status, last_success_at);

CREATE TABLE status_suggestions (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  proposed_status TEXT NOT NULL CHECK (
    proposed_status IN ('inbox', 'todo', 'focus', 'ai_running', 'review', 'blocked', 'done')
  ),
  base_status TEXT NOT NULL CHECK (
    base_status IN ('inbox', 'todo', 'focus', 'ai_running', 'review', 'blocked', 'done')
  ),
  base_work_item_revision INTEGER NOT NULL CHECK (base_work_item_revision >= 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  observed_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'applied', 'ignored', 'stale')),
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX status_suggestions_one_pending_source
  ON status_suggestions(work_item_id, source, proposed_status)
  WHERE state = 'pending';
CREATE INDEX status_suggestions_pending
  ON status_suggestions(state, created_at DESC);

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

CREATE UNIQUE INDEX completion_records_one_active
  ON completion_records(work_item_id) WHERE state = 'active';
CREATE INDEX completion_records_history
  ON completion_records(completed_at DESC, jira_project_key, work_item_id);

CREATE TABLE work_focus_slot (
  slot INTEGER PRIMARY KEY NOT NULL CHECK (slot = 1),
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO work_focus_slot(slot, work_item_id, revision, updated_at)
SELECT 1, (SELECT id FROM work_items WHERE status = 'focus' LIMIT 1), 0,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

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

CREATE INDEX work_focus_commands_status_time
  ON work_focus_transition_commands(status, created_at DESC);
CREATE INDEX work_focus_commands_current
  ON work_focus_transition_commands(current_work_item_id, created_at DESC);
CREATE INDEX work_focus_commands_requested
  ON work_focus_transition_commands(requested_work_item_id, created_at DESC);

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
  SET status = 'focus',
      completed_at = NULL,
      blocked_reason = NULL,
      resume_condition = NULL,
      next_review_at = NULL,
      last_focused_at = NEW.created_at,
      transition_correlation_id = NEW.correlation_id,
      revision = revision + 1,
      updated_at = NEW.created_at
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

INSERT INTO completion_records(
  id, work_item_id, result_summary, provenance, base_work_item_revision, completed_at, created_at
)
SELECT 'legacy-' || id, id, '', 'legacy-inferred', revision,
       COALESCE(completed_at, updated_at), COALESCE(completed_at, updated_at)
FROM work_items
WHERE status = 'done';
