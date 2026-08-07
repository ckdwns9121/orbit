CREATE TABLE inbox_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('jira', 'slack', 'ai')),
  external_key TEXT NOT NULL,
  external_version TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  goal TEXT,
  external_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'adopted', 'linked', 'ignored', 'expired')),
  linked_work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  ignored_version TEXT,
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, external_key)
);

CREATE INDEX inbox_candidates_status_time
  ON inbox_candidates(status, updated_at DESC);
CREATE INDEX inbox_candidates_work_item
  ON inbox_candidates(linked_work_item_id);

CREATE TABLE external_action_requests (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('jira')),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('transition-status')),
  external_key TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  target_state TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  transition_name TEXT NOT NULL,
  available_transitions_hash TEXT NOT NULL,
  preview_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'awaiting-approval', 'approved', 'executing', 'succeeded',
    'failed', 'cancelled', 'needs-reconciliation'
  )),
  approved_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (
    'auth', 'rate-limit', 'network', 'server', 'validation', 'unknown-outcome'
  )),
  error_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX external_actions_recovery
  ON external_action_requests(status, updated_at);
CREATE INDEX external_actions_work_item
  ON external_action_requests(work_item_id, created_at DESC);

CREATE TRIGGER inbox_candidate_action_event
AFTER UPDATE OF status ON inbox_candidates
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NEW.status IN ('adopted', 'linked', 'ignored')
BEGIN
  INSERT INTO activity_events(
    id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.linked_work_item_id,
    CASE NEW.status WHEN 'adopted' THEN 'inbox_adopted'
      WHEN 'linked' THEN 'inbox_linked' ELSE 'inbox_ignored' END,
    lower(hex(randomblob(16))), NEW.source,
    json_object('candidateSource', NEW.source), NEW.updated_at
  );
END;

CREATE TRIGGER external_action_state_event
AFTER UPDATE OF status ON external_action_requests
FOR EACH ROW
WHEN NEW.status <> OLD.status
BEGIN
  INSERT INTO activity_events(
    id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.work_item_id, 'external_action_changed', NEW.id,
    NEW.provider, json_object('actionKind', NEW.action_kind, 'toStatus', NEW.status), NEW.updated_at
  );
END;

DROP TRIGGER IF EXISTS work_items_cleanup_connections;
CREATE TRIGGER work_items_cleanup_connections
BEFORE DELETE ON work_items
FOR EACH ROW
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM external_action_requests
    WHERE work_item_id = OLD.id AND status IN ('executing', 'needs-reconciliation')
  ) THEN RAISE(ABORT, 'task_has_unreconciled_external_action') END;

  INSERT INTO activity_events(
    id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at
  ) VALUES (
    lower(hex(randomblob(16))), OLD.id, 'task_deleted', lower(hex(randomblob(16))),
    'orbit', json_object('formerStatus', OLD.status),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

  UPDATE ai_sessions SET linked_work_item_id = NULL WHERE linked_work_item_id = OLD.id;
  DELETE FROM work_item_links WHERE work_item_id = OLD.id;
  UPDATE inbox_candidates
  SET linked_work_item_id = NULL,
      status = CASE WHEN status IN ('adopted', 'linked') THEN 'new' ELSE status END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE linked_work_item_id = OLD.id;
  DELETE FROM external_action_requests WHERE work_item_id = OLD.id;
END;
