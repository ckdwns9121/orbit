CREATE TABLE automation_prepared_drafts (
  action_id TEXT PRIMARY KEY NOT NULL REFERENCES automation_actions(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  checkpoint TEXT NOT NULL CHECK (length(trim(checkpoint)) > 0),
  next_action TEXT NOT NULL CHECK (length(trim(next_action)) > 0),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX automation_prepared_drafts_work_item
  ON automation_prepared_drafts(work_item_id, created_at DESC);

CREATE TRIGGER automation_action_execute
AFTER INSERT ON automation_actions
FOR EACH ROW
WHEN NEW.state = 'executed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM automation_rules r
    WHERE r.id = NEW.rule_id
      AND r.rule_kind = NEW.rule_kind
      AND r.normalized_source_identity = NEW.normalized_source_identity
      AND r.status = 'enabled'
      AND NEW.confidence >= r.minimum_confidence
  ) THEN RAISE(ABORT, 'automation_rule_not_enabled_or_identity_changed') END;

  SELECT CASE WHEN NEW.rule_kind IN ('exact-external-link', 'exact-inbox-ignore', 'prepare-draft')
      AND json_valid(COALESCE(NEW.undo_payload_json, '')) = 0
    THEN RAISE(ABORT, 'automation_payload_invalid') END;

  SELECT CASE WHEN NEW.rule_kind IN ('exact-external-link', 'exact-inbox-ignore')
      AND (
        NEW.affected_record_type <> 'inbox_candidate'
        OR json_type(NEW.undo_payload_json, '$.candidateId') <> 'text'
        OR json_type(NEW.undo_payload_json, '$.candidateVersion') <> 'text'
        OR json_type(NEW.undo_payload_json, '$.priorStatus') <> 'text'
        OR COALESCE(json_type(NEW.undo_payload_json, '$.priorLinkedWorkItemId'), 'missing')
          NOT IN ('text', 'null')
        OR COALESCE(json_type(NEW.undo_payload_json, '$.priorIgnoredVersion'), 'missing')
          NOT IN ('text', 'null')
        OR json_extract(NEW.undo_payload_json, '$.candidateId') IS NOT NEW.affected_record_id
        OR json_extract(NEW.undo_payload_json, '$.candidateVersion') IS NOT NEW.identity_version
        OR NOT EXISTS (
          SELECT 1 FROM inbox_candidates c
          WHERE c.id = NEW.affected_record_id
            AND c.external_version = NEW.identity_version
            AND c.status = 'new'
            AND c.status IS json_extract(NEW.undo_payload_json, '$.priorStatus')
            AND c.linked_work_item_id IS json_extract(NEW.undo_payload_json, '$.priorLinkedWorkItemId')
            AND c.ignored_version IS json_extract(NEW.undo_payload_json, '$.priorIgnoredVersion')
        )
      )
    THEN RAISE(ABORT, 'automation_candidate_changed') END;

  SELECT CASE WHEN NEW.rule_kind = 'exact-external-link'
      AND (
        json_type(NEW.undo_payload_json, '$.workItemId') <> 'text'
        OR json_extract(NEW.undo_payload_json, '$.source') NOT IN ('jira', 'slack', 'ai')
        OR json_type(NEW.undo_payload_json, '$.externalKey') <> 'text'
        OR length(trim(json_extract(NEW.undo_payload_json, '$.externalKey'))) = 0
        OR COALESCE(json_type(NEW.undo_payload_json, '$.externalUrl'), 'missing')
          NOT IN ('text', 'null')
        OR json_type(NEW.undo_payload_json, '$.label') <> 'text'
        OR length(trim(json_extract(NEW.undo_payload_json, '$.label'))) = 0
        OR COALESCE(json_type(NEW.undo_payload_json, '$.createdLinkId'), 'missing')
          NOT IN ('text', 'null')
        OR COALESCE(json_type(NEW.undo_payload_json, '$.priorAiLinkedWorkItemId'), 'missing')
          NOT IN ('text', 'null')
        OR NOT EXISTS (
          SELECT 1 FROM work_items w
          WHERE w.id = json_extract(NEW.undo_payload_json, '$.workItemId')
        )
      )
    THEN RAISE(ABORT, 'automation_link_target_invalid') END;

  SELECT CASE WHEN NEW.rule_kind = 'exact-external-link'
      AND json_extract(NEW.undo_payload_json, '$.source') IN ('jira', 'slack')
      AND json_type(NEW.undo_payload_json, '$.createdLinkId') = 'null'
      AND NOT EXISTS (
        SELECT 1 FROM work_item_links l
        WHERE l.work_item_id = json_extract(NEW.undo_payload_json, '$.workItemId')
          AND l.kind = json_extract(NEW.undo_payload_json, '$.source')
          AND (
            l.external_id = json_extract(NEW.undo_payload_json, '$.externalKey')
            OR (
              json_type(NEW.undo_payload_json, '$.externalUrl') = 'text'
              AND l.external_url = json_extract(NEW.undo_payload_json, '$.externalUrl')
            )
          )
      )
    THEN RAISE(ABORT, 'automation_existing_link_missing') END;

  SELECT CASE WHEN NEW.rule_kind = 'exact-external-link'
      AND json_extract(NEW.undo_payload_json, '$.source') = 'ai'
      AND (
        json_type(NEW.undo_payload_json, '$.createdLinkId') <> 'null'
        OR NOT EXISTS (
          SELECT 1 FROM ai_sessions s
          WHERE (s.provider || ':' || s.session_id) =
              json_extract(NEW.undo_payload_json, '$.externalKey')
            AND s.linked_work_item_id IS
              json_extract(NEW.undo_payload_json, '$.priorAiLinkedWorkItemId')
        )
      )
    THEN RAISE(ABORT, 'automation_ai_session_changed') END;

  UPDATE inbox_candidates
  SET status = 'linked',
      linked_work_item_id = json_extract(NEW.undo_payload_json, '$.workItemId'),
      ignored_version = NULL,
      updated_at = NEW.created_at
  WHERE NEW.rule_kind = 'exact-external-link' AND id = NEW.affected_record_id;

  INSERT INTO work_item_links(
    id, work_item_id, kind, external_id, external_url, label, status, created_at
  )
  SELECT
    json_extract(NEW.undo_payload_json, '$.createdLinkId'),
    json_extract(NEW.undo_payload_json, '$.workItemId'),
    json_extract(NEW.undo_payload_json, '$.source'),
    json_extract(NEW.undo_payload_json, '$.externalKey'),
    json_extract(NEW.undo_payload_json, '$.externalUrl'),
    json_extract(NEW.undo_payload_json, '$.label'),
    'linked', NEW.created_at
  WHERE NEW.rule_kind = 'exact-external-link'
    AND json_type(NEW.undo_payload_json, '$.createdLinkId') = 'text'
    AND json_extract(NEW.undo_payload_json, '$.source') IN ('jira', 'slack');

  UPDATE ai_sessions
  SET linked_work_item_id = json_extract(NEW.undo_payload_json, '$.workItemId'),
      acknowledged_at_ms = modified_at_ms
  WHERE NEW.rule_kind = 'exact-external-link'
    AND json_extract(NEW.undo_payload_json, '$.source') = 'ai'
    AND (provider || ':' || session_id) = json_extract(NEW.undo_payload_json, '$.externalKey');

  UPDATE inbox_candidates
  SET status = 'ignored', ignored_version = external_version,
      linked_work_item_id = NULL, updated_at = NEW.created_at
  WHERE NEW.rule_kind = 'exact-inbox-ignore' AND id = NEW.affected_record_id;

  SELECT CASE WHEN NEW.rule_kind = 'prepare-draft'
      AND (
        NEW.affected_record_type <> 'work_item'
        OR json_type(NEW.undo_payload_json, '$.workItemId') <> 'text'
        OR json_extract(NEW.undo_payload_json, '$.workItemId') IS NOT NEW.affected_record_id
        OR json_type(NEW.undo_payload_json, '$.checkpoint') <> 'text'
        OR length(trim(json_extract(NEW.undo_payload_json, '$.checkpoint'))) = 0
        OR json_type(NEW.undo_payload_json, '$.nextAction') <> 'text'
        OR length(trim(json_extract(NEW.undo_payload_json, '$.nextAction'))) = 0
        OR json_type(NEW.undo_payload_json, '$.evidenceJson') <> 'text'
        OR json_valid(json_extract(NEW.undo_payload_json, '$.evidenceJson')) = 0
        OR NOT EXISTS (
          SELECT 1 FROM work_items w
          WHERE w.id = NEW.affected_record_id
            AND CAST(w.revision AS TEXT) = NEW.identity_version
        )
      )
    THEN RAISE(ABORT, 'automation_draft_target_changed') END;

  INSERT INTO automation_prepared_drafts(
    action_id, work_item_id, checkpoint, next_action, evidence_json, created_at
  )
  SELECT NEW.id, NEW.affected_record_id,
    trim(json_extract(NEW.undo_payload_json, '$.checkpoint')),
    trim(json_extract(NEW.undo_payload_json, '$.nextAction')),
    COALESCE(json_extract(NEW.undo_payload_json, '$.evidenceJson'), '[]'),
    NEW.created_at
  WHERE NEW.rule_kind = 'prepare-draft';

  SELECT CASE WHEN NEW.rule_kind = 'refresh-stale-read'
      AND NEW.affected_record_type <> 'source_sync_scope'
    THEN RAISE(ABORT, 'automation_refresh_scope_invalid') END;
END;

CREATE TRIGGER automation_action_undo
BEFORE UPDATE OF state ON automation_actions
FOR EACH ROW
WHEN OLD.state = 'executed' AND NEW.state = 'undone'
BEGIN
  SELECT CASE WHEN OLD.rule_kind NOT IN ('exact-external-link', 'exact-inbox-ignore')
    THEN RAISE(ABORT, 'automation_action_not_reversible') END;
  SELECT CASE WHEN json_valid(COALESCE(OLD.undo_payload_json, '')) = 0
    THEN RAISE(ABORT, 'automation_undo_payload_invalid') END;
  SELECT CASE WHEN json_type(OLD.undo_payload_json, '$.candidateId') <> 'text'
      OR json_extract(OLD.undo_payload_json, '$.candidateId') IS NOT OLD.affected_record_id
      OR json_type(OLD.undo_payload_json, '$.priorStatus') <> 'text'
      OR json_type(OLD.undo_payload_json, '$.candidateVersion') <> 'text'
      OR COALESCE(json_type(OLD.undo_payload_json, '$.priorLinkedWorkItemId'), 'missing')
        NOT IN ('text', 'null')
      OR COALESCE(json_type(OLD.undo_payload_json, '$.priorIgnoredVersion'), 'missing')
        NOT IN ('text', 'null')
    THEN RAISE(ABORT, 'automation_undo_payload_incomplete') END;
  SELECT CASE WHEN OLD.rule_kind = 'exact-external-link'
      AND (
        json_type(OLD.undo_payload_json, '$.workItemId') <> 'text'
        OR json_extract(OLD.undo_payload_json, '$.source') NOT IN ('jira', 'slack', 'ai')
        OR json_type(OLD.undo_payload_json, '$.externalKey') <> 'text'
        OR COALESCE(json_type(OLD.undo_payload_json, '$.createdLinkId'), 'missing')
          NOT IN ('text', 'null')
        OR COALESCE(json_type(OLD.undo_payload_json, '$.priorAiLinkedWorkItemId'), 'missing')
          NOT IN ('text', 'null')
      )
    THEN RAISE(ABORT, 'automation_undo_payload_incomplete') END;
  SELECT CASE WHEN OLD.rule_kind = 'exact-external-link' AND NOT EXISTS (
    SELECT 1 FROM inbox_candidates c
    WHERE c.id = OLD.affected_record_id
      AND c.external_version = OLD.identity_version
      AND c.status = 'linked'
      AND c.linked_work_item_id IS json_extract(OLD.undo_payload_json, '$.workItemId')
  ) THEN RAISE(ABORT, 'automation_undo_target_changed') END;
  SELECT CASE WHEN OLD.rule_kind = 'exact-inbox-ignore' AND NOT EXISTS (
    SELECT 1 FROM inbox_candidates c
    WHERE c.id = OLD.affected_record_id
      AND c.external_version = OLD.identity_version
      AND c.status = 'ignored'
      AND c.ignored_version = OLD.identity_version
  ) THEN RAISE(ABORT, 'automation_undo_target_changed') END;

  SELECT CASE WHEN OLD.rule_kind = 'exact-external-link'
      AND json_extract(OLD.undo_payload_json, '$.source') IN ('jira', 'slack')
      AND json_type(OLD.undo_payload_json, '$.createdLinkId') = 'text'
      AND NOT EXISTS (
        SELECT 1 FROM work_item_links l
        WHERE l.id = json_extract(OLD.undo_payload_json, '$.createdLinkId')
          AND l.work_item_id = json_extract(OLD.undo_payload_json, '$.workItemId')
          AND l.kind = json_extract(OLD.undo_payload_json, '$.source')
          AND l.external_id IS json_extract(OLD.undo_payload_json, '$.externalKey')
          AND l.external_url IS json_extract(OLD.undo_payload_json, '$.externalUrl')
          AND l.label IS json_extract(OLD.undo_payload_json, '$.label')
          AND l.status = 'linked'
          AND l.last_synced_at IS NULL
          AND l.created_at = OLD.created_at
      )
    THEN RAISE(ABORT, 'automation_undo_child_link_changed') END;

  SELECT CASE WHEN OLD.rule_kind = 'exact-external-link'
      AND json_extract(OLD.undo_payload_json, '$.source') = 'ai'
      AND NOT EXISTS (
        SELECT 1 FROM ai_sessions s
        WHERE (s.provider || ':' || s.session_id) =
            json_extract(OLD.undo_payload_json, '$.externalKey')
          AND s.linked_work_item_id IS
            json_extract(OLD.undo_payload_json, '$.workItemId')
      )
    THEN RAISE(ABORT, 'automation_undo_ai_session_changed') END;

  UPDATE inbox_candidates
  SET status = json_extract(OLD.undo_payload_json, '$.priorStatus'),
      linked_work_item_id = json_extract(OLD.undo_payload_json, '$.priorLinkedWorkItemId'),
      ignored_version = json_extract(OLD.undo_payload_json, '$.priorIgnoredVersion'),
      updated_at = NEW.updated_at
  WHERE id = OLD.affected_record_id;

  DELETE FROM work_item_links
  WHERE OLD.rule_kind = 'exact-external-link'
    AND json_type(OLD.undo_payload_json, '$.createdLinkId') = 'text'
    AND id = json_extract(OLD.undo_payload_json, '$.createdLinkId');

  UPDATE ai_sessions
  SET linked_work_item_id = json_extract(OLD.undo_payload_json, '$.priorAiLinkedWorkItemId')
  WHERE OLD.rule_kind = 'exact-external-link'
    AND json_extract(OLD.undo_payload_json, '$.source') = 'ai'
    AND (provider || ':' || session_id) = json_extract(OLD.undo_payload_json, '$.externalKey');
END;

CREATE TRIGGER automation_draft_discard
BEFORE UPDATE OF state ON automation_actions
FOR EACH ROW
WHEN OLD.rule_kind = 'prepare-draft' AND OLD.state = 'executed' AND NEW.state = 'discarded'
BEGIN
  DELETE FROM automation_prepared_drafts WHERE action_id = OLD.id;
END;
