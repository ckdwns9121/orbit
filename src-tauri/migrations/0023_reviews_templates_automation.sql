CREATE TABLE weekly_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot_json TEXT NOT NULL,
  partial_sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(week_start, week_end, version)
);

CREATE INDEX weekly_reviews_period
  ON weekly_reviews(week_start DESC, version DESC);

CREATE TABLE task_templates (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  title_tokens TEXT NOT NULL,
  jira_project_key TEXT,
  source_signature TEXT,
  source_work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  adoption_count INTEGER NOT NULL DEFAULT 0 CHECK (adoption_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_template_checklist_items (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX template_checklist_order
  ON task_template_checklist_items(template_id, position);

CREATE TABLE work_item_checklist_items (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES task_templates(id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  completed_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX work_item_checklist_order
  ON work_item_checklist_items(work_item_id, position);

CREATE TABLE template_recommendation_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  template_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  created_at TEXT NOT NULL,
  UNIQUE(work_item_id, template_id, template_version)
);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY NOT NULL,
  rule_kind TEXT NOT NULL CHECK (rule_kind IN (
    'exact-external-link', 'exact-inbox-ignore', 'prepare-draft', 'refresh-stale-read'
  )),
  normalized_source_identity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'enabled', 'disabled')),
  minimum_confidence REAL NOT NULL DEFAULT 1.0 CHECK (minimum_confidence >= 0 AND minimum_confidence <= 1),
  consecutive_approvals INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_approvals >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(rule_kind, normalized_source_identity)
);

CREATE TABLE automation_actions (
  id TEXT PRIMARY KEY NOT NULL,
  rule_id TEXT REFERENCES automation_rules(id) ON DELETE SET NULL,
  rule_kind TEXT NOT NULL,
  normalized_source_identity TEXT NOT NULL,
  affected_record_type TEXT NOT NULL,
  affected_record_id TEXT NOT NULL,
  identity_version TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('suggested', 'executed', 'undone', 'discarded')),
  undo_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(rule_kind, normalized_source_identity, affected_record_type, affected_record_id, identity_version)
);

CREATE INDEX automation_actions_state_time
  ON automation_actions(state, created_at DESC);
