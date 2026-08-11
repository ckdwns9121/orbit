-- Graph data is derived. Rebuild the graph schema without touching canonical source tables.
DROP TRIGGER IF EXISTS context_graph_dirty_work_items_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_work_items_update;
DROP TRIGGER IF EXISTS context_graph_dirty_work_items_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_work_item_links_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_work_item_links_update;
DROP TRIGGER IF EXISTS context_graph_dirty_work_item_links_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_jira_issues_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_jira_issues_update;
DROP TRIGGER IF EXISTS context_graph_dirty_jira_issues_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_github_pull_requests_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_github_pull_requests_update;
DROP TRIGGER IF EXISTS context_graph_dirty_github_pull_requests_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_slack_messages_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_slack_messages_update;
DROP TRIGGER IF EXISTS context_graph_dirty_slack_messages_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_confluence_pages_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_confluence_pages_update;
DROP TRIGGER IF EXISTS context_graph_dirty_confluence_pages_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_calendar_events_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_calendar_events_update;
DROP TRIGGER IF EXISTS context_graph_dirty_calendar_events_delete;
DROP TRIGGER IF EXISTS context_graph_dirty_ai_sessions_insert;
DROP TRIGGER IF EXISTS context_graph_dirty_ai_sessions_update;
DROP TRIGGER IF EXISTS context_graph_dirty_ai_sessions_delete;
DROP TABLE IF EXISTS context_graph_index_state;
DROP TABLE IF EXISTS context_graph_edges;
DROP TABLE IF EXISTS context_graph_nodes;
DROP TABLE IF EXISTS context_graph_generations;
DROP TABLE IF EXISTS context_graph_source_state;
CREATE TABLE context_graph_generations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  source_fingerprint TEXT NOT NULL CHECK (length(trim(source_fingerprint)) > 0),
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'ready', 'failed')),
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  completed_at TEXT,
  node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  edge_count INTEGER NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  error_summary TEXT,
  CHECK (
    (status = 'building' AND completed_at IS NULL AND error_summary IS NULL)
    OR (status = 'ready' AND completed_at IS NOT NULL AND error_summary IS NULL)
    OR (
      status = 'failed'
      AND completed_at IS NOT NULL
      AND length(trim(COALESCE(error_summary, ''))) > 0
    )
  )
);

CREATE TABLE context_graph_nodes (
  generation_id TEXT NOT NULL
    REFERENCES context_graph_generations(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) > 0),
  node_type TEXT NOT NULL CHECK (
    node_type IN (
      'task',
      'jira_issue',
      'pull_request',
      'github_commit',
      'slack_message',
      'confluence_page',
      'calendar_event',
      'ai_session'
    )
  ),
  source_type TEXT NOT NULL CHECK (length(trim(source_type)) > 0),
  source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  body TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  url TEXT CHECK (url IS NULL OR length(trim(url)) > 0),
  occurred_at TEXT,
  updated_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  PRIMARY KEY (generation_id, id),
  UNIQUE (generation_id, node_type, source_type, source_id)
);

CREATE INDEX context_graph_nodes_type_source
  ON context_graph_nodes(generation_id, node_type, source_type, source_id);

CREATE INDEX context_graph_nodes_occurred_at
  ON context_graph_nodes(generation_id, occurred_at DESC);

CREATE INDEX context_graph_nodes_updated_at
  ON context_graph_nodes(generation_id, updated_at DESC);

CREATE INDEX context_graph_nodes_search_order
  ON context_graph_nodes(generation_id, node_type, updated_at DESC);

CREATE TABLE context_graph_edges (
  generation_id TEXT NOT NULL
    REFERENCES context_graph_generations(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) > 0),
  from_node_id TEXT NOT NULL CHECK (length(trim(from_node_id)) > 0),
  to_node_id TEXT NOT NULL CHECK (length(trim(to_node_id)) > 0),
  relation_type TEXT NOT NULL CHECK (length(trim(relation_type)) > 0),
  derivation_kind TEXT NOT NULL
    CHECK (derivation_kind IN ('explicit', 'inferred', 'system')),
  weight REAL NOT NULL CHECK (weight >= 0.0 AND weight <= 1.0),
  evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  PRIMARY KEY (generation_id, id),
  UNIQUE (generation_id, from_node_id, to_node_id, relation_type),
  CHECK (from_node_id <> to_node_id),
  FOREIGN KEY (generation_id, from_node_id)
    REFERENCES context_graph_nodes(generation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id, to_node_id)
    REFERENCES context_graph_nodes(generation_id, id) ON DELETE CASCADE
);

CREATE INDEX context_graph_edges_from
  ON context_graph_edges(generation_id, from_node_id, weight DESC);

CREATE INDEX context_graph_edges_to
  ON context_graph_edges(generation_id, to_node_id, weight DESC);

CREATE INDEX context_graph_edges_relation
  ON context_graph_edges(generation_id, relation_type, weight DESC);

CREATE INDEX context_graph_edges_weight
  ON context_graph_edges(generation_id, weight DESC);

CREATE TABLE context_graph_index_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  current_generation_id TEXT
    REFERENCES context_graph_generations(id) ON DELETE SET NULL,
  source_fingerprint TEXT NOT NULL DEFAULT '',
  node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  edge_count INTEGER NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  rebuild_started_at TEXT,
  rebuild_completed_at TEXT,
  CHECK (
    current_generation_id IS NOT NULL
    OR (
      source_fingerprint = ''
      AND node_count = 0
      AND edge_count = 0
      AND rebuild_started_at IS NULL
      AND rebuild_completed_at IS NULL
    )
  )
);

CREATE TABLE context_graph_source_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT
);

INSERT INTO context_graph_source_state(id, revision) VALUES (1, 0);

CREATE TRIGGER context_graph_dirty_work_items_insert AFTER INSERT ON work_items BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_work_items_update AFTER UPDATE ON work_items BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_work_items_delete AFTER DELETE ON work_items BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_work_item_links_insert AFTER INSERT ON work_item_links BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_work_item_links_update AFTER UPDATE ON work_item_links BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_work_item_links_delete AFTER DELETE ON work_item_links BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_jira_issues_insert AFTER INSERT ON jira_issues BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_jira_issues_update AFTER UPDATE ON jira_issues BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_jira_issues_delete AFTER DELETE ON jira_issues BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_github_pull_requests_insert AFTER INSERT ON github_pull_requests BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_github_pull_requests_update AFTER UPDATE ON github_pull_requests BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_github_pull_requests_delete AFTER DELETE ON github_pull_requests BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_slack_messages_insert AFTER INSERT ON slack_messages BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_slack_messages_update AFTER UPDATE ON slack_messages BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_slack_messages_delete AFTER DELETE ON slack_messages BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_confluence_pages_insert AFTER INSERT ON confluence_pages BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_confluence_pages_update AFTER UPDATE ON confluence_pages BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_confluence_pages_delete AFTER DELETE ON confluence_pages BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_calendar_events_insert AFTER INSERT ON calendar_events BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_calendar_events_update AFTER UPDATE ON calendar_events BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_calendar_events_delete AFTER DELETE ON calendar_events BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_dirty_ai_sessions_insert AFTER INSERT ON ai_sessions BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_ai_sessions_update AFTER UPDATE ON ai_sessions BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;
CREATE TRIGGER context_graph_dirty_ai_sessions_delete AFTER DELETE ON ai_sessions BEGIN
  UPDATE context_graph_source_state SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
END;

CREATE TRIGGER context_graph_generation_insert_guard
BEFORE INSERT ON context_graph_generations
FOR EACH ROW
WHEN NEW.status <> 'building'
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_must_start_building');
END;

CREATE TRIGGER context_graph_generation_ready_guard
BEFORE UPDATE OF status ON context_graph_generations
FOR EACH ROW
WHEN NEW.status = 'ready' AND OLD.status <> 'ready'
BEGIN
  SELECT CASE
    WHEN NEW.node_count <> (
      SELECT COUNT(*)
      FROM context_graph_nodes
      WHERE generation_id = NEW.id
    )
    THEN RAISE(ABORT, 'context_graph_node_count_mismatch')
  END;

  SELECT CASE
    WHEN NEW.edge_count <> (
      SELECT COUNT(*)
      FROM context_graph_edges
      WHERE generation_id = NEW.id
    )
    THEN RAISE(ABORT, 'context_graph_edge_count_mismatch')
  END;
END;

CREATE TRIGGER context_graph_generation_publish
AFTER UPDATE OF status ON context_graph_generations
FOR EACH ROW
WHEN NEW.status = 'ready' AND OLD.status <> 'ready'
BEGIN
  INSERT INTO context_graph_index_state(
    id,
    schema_version,
    current_generation_id,
    source_fingerprint,
    node_count,
    edge_count,
    rebuild_started_at,
    rebuild_completed_at
  ) VALUES (
    1,
    NEW.schema_version,
    NEW.id,
    NEW.source_fingerprint,
    NEW.node_count,
    NEW.edge_count,
    NEW.started_at,
    NEW.completed_at
  )
  ON CONFLICT(id) DO UPDATE SET
    schema_version = excluded.schema_version,
    current_generation_id = excluded.current_generation_id,
    source_fingerprint = excluded.source_fingerprint,
    node_count = excluded.node_count,
    edge_count = excluded.edge_count,
    rebuild_started_at = excluded.rebuild_started_at,
    rebuild_completed_at = excluded.rebuild_completed_at;
END;

CREATE TRIGGER context_graph_generation_terminal_immutable
BEFORE UPDATE ON context_graph_generations
FOR EACH ROW
WHEN OLD.status IN ('ready', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'context_graph_terminal_generation_is_immutable');
END;

CREATE TRIGGER context_graph_node_insert_guard
BEFORE INSERT ON context_graph_nodes
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM context_graph_generations
  WHERE id = NEW.generation_id AND status = 'building'
)
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_not_building');
END;

CREATE TRIGGER context_graph_node_update_guard
BEFORE UPDATE ON context_graph_nodes
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM context_graph_generations
    WHERE id = OLD.generation_id AND status = 'building'
  )
  OR NOT EXISTS (
    SELECT 1 FROM context_graph_generations
    WHERE id = NEW.generation_id AND status = 'building'
  )
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_not_building');
END;

CREATE TRIGGER context_graph_node_delete_guard
BEFORE DELETE ON context_graph_nodes
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM context_graph_generations
  WHERE id = OLD.generation_id AND status <> 'building'
)
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_not_building');
END;

CREATE TRIGGER context_graph_edge_insert_guard
BEFORE INSERT ON context_graph_edges
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM context_graph_generations
  WHERE id = NEW.generation_id AND status = 'building'
)
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_not_building');
END;

CREATE TRIGGER context_graph_edge_update_guard
BEFORE UPDATE ON context_graph_edges
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM context_graph_generations
    WHERE id = OLD.generation_id AND status = 'building'
  )
  OR NOT EXISTS (
    SELECT 1 FROM context_graph_generations
    WHERE id = NEW.generation_id AND status = 'building'
  )
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_not_building');
END;

CREATE TRIGGER context_graph_edge_delete_guard
BEFORE DELETE ON context_graph_edges
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM context_graph_generations
  WHERE id = OLD.generation_id AND status <> 'building'
)
BEGIN
  SELECT RAISE(ABORT, 'context_graph_generation_not_building');
END;

CREATE TRIGGER context_graph_index_state_generation_guard
BEFORE INSERT ON context_graph_index_state
FOR EACH ROW
WHEN NEW.current_generation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM context_graph_generations
    WHERE id = NEW.current_generation_id
      AND status = 'ready'
      AND schema_version = NEW.schema_version
      AND source_fingerprint = NEW.source_fingerprint
      AND node_count = NEW.node_count
      AND edge_count = NEW.edge_count
      AND started_at IS NEW.rebuild_started_at
      AND completed_at IS NEW.rebuild_completed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'context_graph_index_state_mismatch');
END;

CREATE TRIGGER context_graph_index_state_generation_update_guard
BEFORE UPDATE ON context_graph_index_state
FOR EACH ROW
WHEN NEW.current_generation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM context_graph_generations
    WHERE id = NEW.current_generation_id
      AND status = 'ready'
      AND schema_version = NEW.schema_version
      AND source_fingerprint = NEW.source_fingerprint
      AND node_count = NEW.node_count
      AND edge_count = NEW.edge_count
      AND started_at IS NEW.rebuild_started_at
      AND completed_at IS NEW.rebuild_completed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'context_graph_index_state_mismatch');
END;

CREATE TRIGGER context_graph_current_generation_delete_guard
BEFORE DELETE ON context_graph_generations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM context_graph_index_state
  WHERE id = 1 AND current_generation_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'context_graph_current_generation_cannot_be_pruned');
END;
