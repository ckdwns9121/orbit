import { afterEach, describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const migrationDirectory = resolve(import.meta.dir, "../../src-tauri/migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

const openDatabases: Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function createDatabase(through = 26): Database {
  const database = new Database(":memory:");
  openDatabases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyMigrations(database, 1, through);
  return database;
}

function applyMigrations(database: Database, from: number, through: number): void {
  for (const file of migrationFiles) {
    const version = Number(file.slice(0, 4));
    if (version < from || version > through) continue;
    database.exec(readFileSync(resolve(migrationDirectory, file), "utf8"));
  }
}

function insertWorkItem(
  database: Database,
  id: string,
  status: "todo" | "focus" | "done" = "todo",
  completedAt: string | null = null,
): void {
  database.run(
    `INSERT INTO work_items(
      id, title, status, source, position, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, 'orbit', 0, ?, ?, ?)`,
    [id, `Task ${id}`, status, "2026-08-07T01:00:00.000Z", "2026-08-07T01:00:00.000Z", completedAt],
  );
}

function insertFocusCommand(
  database: Database,
  values: {
    id: string;
    correlationId: string;
    currentId: string | null;
    requestedId: string | null;
    slotRevision: number;
    currentRevision?: number | null;
    requestedRevision?: number | null;
    releaseStatus?: "todo" | "ai_running" | "review" | "blocked" | null;
    checkpoint?: string | null;
    nextAction?: string | null;
    blockedReason?: string | null;
    resumeCondition?: string | null;
    nextReviewAt?: string | null;
  },
): void {
  database.run(
    `INSERT INTO work_focus_transition_commands(
      id, correlation_id, current_work_item_id, requested_work_item_id,
      expected_slot_revision, expected_current_revision, expected_requested_revision,
      release_status, checkpoint, next_action, blocked_reason, resume_condition,
      next_review_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.id,
      values.correlationId,
      values.currentId,
      values.requestedId,
      values.slotRevision,
      values.currentRevision ?? null,
      values.requestedRevision ?? null,
      values.releaseStatus ?? null,
      values.checkpoint ?? null,
      values.nextAction ?? null,
      values.blockedReason ?? null,
      values.resumeCondition ?? null,
      values.nextReviewAt ?? null,
      "2026-08-07T02:00:00.000Z",
    ],
  );
}

function acquireFocus(database: Database, workItemId: string, commandSuffix = workItemId): void {
  insertFocusCommand(database, {
    id: `acquire-${commandSuffix}`,
    correlationId: `acquire-correlation-${commandSuffix}`,
    currentId: null,
    requestedId: workItemId,
    slotRevision: 0,
    requestedRevision: 0,
  });
}

function row<T>(database: Database, sql: string, parameters: SQLQueryBindings[] = []): T {
  return database.query(sql).get(...parameters) as T;
}

function rows<T>(database: Database, sql: string, parameters: SQLQueryBindings[] = []): T[] {
  return database.query(sql).all(...parameters) as T[];
}

function expectForeignKeysValid(database: Database): void {
  expect(rows(database, "PRAGMA foreign_key_check")).toEqual([]);
}

describe("work continuity migrations", () => {
  test("apply to an empty database with all expected tables and triggers", () => {
    const database = createDatabase();

    const objects = rows<{ name: string; type: string }>(
      database,
      `SELECT name, type FROM sqlite_master
       WHERE name IN (
         'activity_events', 'source_sync_state', 'status_suggestions',
         'completion_records', 'work_focus_slot', 'work_focus_transition_commands',
         'inbox_candidates', 'external_action_requests', 'weekly_reviews',
         'task_templates', 'automation_rules', 'work_items_transition_guard',
         'work_focus_command_apply', 'completion_record_apply'
       )
       ORDER BY name`,
    );

    expect(objects).toHaveLength(14);
    expect(row<{ revision: number; work_item_id: string | null }>(
      database,
      "SELECT revision, work_item_id FROM work_focus_slot WHERE slot = 1",
    )).toEqual({ revision: 0, work_item_id: null });
    expectForeignKeysValid(database);
  });

  test("upgrades representative existing data without losing links or completion history", () => {
    const database = createDatabase(20);
    insertWorkItem(database, "existing-focus", "focus");
    insertWorkItem(database, "existing-done", "done", "2026-08-06T10:00:00.000Z");
    insertWorkItem(database, "existing-done-without-time", "done");
    insertWorkItem(database, "existing-todo");
    database.run(
      `INSERT INTO ai_sessions(
        provider, session_id, title, modified_at_ms, acknowledged_at_ms,
        linked_work_item_id, discovered_at, completion_state
      ) VALUES ('codex', 'session-1', 'Existing session', 1, 1, 'existing-focus', ?, 'active')`,
      ["2026-08-07T01:00:00.000Z"],
    );
    database.run(
      `INSERT INTO work_item_links(
        id, work_item_id, kind, external_id, label, status, created_at
      ) VALUES ('link-1', 'existing-todo', 'jira', 'ORB-1', 'ORB-1', 'linked', ?)`,
      ["2026-08-07T01:00:00.000Z"],
    );

    applyMigrations(database, 21, 23);

    expect(row<{ work_item_id: string | null }>(
      database,
      "SELECT work_item_id FROM work_focus_slot WHERE slot = 1",
    ).work_item_id).toBe("existing-focus");
    expect(row<{ linked_work_item_id: string | null }>(
      database,
      "SELECT linked_work_item_id FROM ai_sessions WHERE session_id = 'session-1'",
    ).linked_work_item_id).toBe("existing-focus");
    expect(row<{ work_item_id: string }>(
      database,
      "SELECT work_item_id FROM work_item_links WHERE id = 'link-1'",
    ).work_item_id).toBe("existing-todo");
    expect(row<{ provenance: string; completed_at: string }>(
      database,
      "SELECT provenance, completed_at FROM completion_records WHERE work_item_id = 'existing-done'",
    )).toEqual({ provenance: "legacy-inferred", completed_at: "2026-08-06T10:00:00.000Z" });
    expect(row<{ revision: number }>(
      database,
      "SELECT revision FROM work_items WHERE id = 'existing-done'",
    ).revision).toBe(0);
    expect(row<{ provenance: string; completed_at: string }>(
      database,
      "SELECT provenance, completed_at FROM completion_records WHERE work_item_id = 'existing-done-without-time'",
    )).toEqual({ provenance: "legacy-inferred", completed_at: "2026-08-07T01:00:00.000Z" });
    expectForeignKeysValid(database);
  });

  test("repairs an interim completion schema without losing completion history", () => {
    const database = createDatabase(24);
    insertWorkItem(database, "legacy-done", "done", "2026-08-06T10:00:00.000Z");
    database.run(
      `INSERT INTO completion_records(
        id, work_item_id, result_summary, provenance, base_work_item_revision,
        completed_at, created_at
      ) VALUES ('legacy-record', 'legacy-done', 'Preserved result', 'legacy-inferred', 0, ?, ?)`,
      ["2026-08-06T10:00:00.000Z", "2026-08-06T10:00:00.000Z"],
    );

    database.exec(`
      DROP TRIGGER completion_record_apply;
      DROP TRIGGER work_items_transition_guard;
      DROP TRIGGER work_items_transition_event;
      DROP INDEX completion_records_one_active;
      DROP INDEX completion_records_history;
      ALTER TABLE completion_records RENAME TO completion_records_current;
      CREATE TABLE completion_records (
        id TEXT PRIMARY KEY NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        result_summary TEXT NOT NULL DEFAULT '', decisions TEXT NOT NULL DEFAULT '',
        remaining_risk TEXT NOT NULL DEFAULT '', retrospective TEXT NOT NULL DEFAULT '',
        jira_project_key TEXT, evidence_json TEXT NOT NULL DEFAULT '[]',
        provenance TEXT NOT NULL DEFAULT 'user', state TEXT NOT NULL DEFAULT 'active',
        superseded_at TEXT, completed_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO completion_records(
        id, work_item_id, result_summary, decisions, remaining_risk, retrospective,
        jira_project_key, evidence_json, provenance, state, superseded_at, completed_at, created_at
      )
      SELECT id, work_item_id, result_summary, decisions, remaining_risk, retrospective,
        jira_project_key, evidence_json, provenance, state, superseded_at, completed_at, created_at
      FROM completion_records_current;
      DROP TABLE completion_records_current;
    `);

    applyMigrations(database, 25, 25);

    expect(rows<{ name: string }>(database, "PRAGMA table_info(completion_records)"))
      .toContainEqual(expect.objectContaining({ name: "base_work_item_revision" }));
    expect(row<{ result_summary: string; provenance: string; base_work_item_revision: number }>(
      database,
      "SELECT result_summary, provenance, base_work_item_revision FROM completion_records WHERE id = 'legacy-record'",
    )).toEqual({
      result_summary: "Preserved result",
      provenance: "legacy-inferred",
      base_work_item_revision: 0,
    });
    expectForeignKeysValid(database);
  });
});

for (const [currentId, requestedId] of [["a-current", "z-requested"], ["z-current", "a-requested"]] as const) {
  test(`focus acquire, swap, and release are order-independent (${currentId} -> ${requestedId})`, () => {
    const database = createDatabase();
    insertWorkItem(database, currentId);
    insertWorkItem(database, requestedId);
    acquireFocus(database, currentId, currentId);

    insertFocusCommand(database, {
      id: `swap-${currentId}`,
      correlationId: `swap-correlation-${currentId}`,
      currentId,
      requestedId,
      slotRevision: 1,
      currentRevision: 1,
      requestedRevision: 0,
      releaseStatus: "review",
      checkpoint: "review-ready checkpoint",
      nextAction: "request reviewer feedback",
    });

    expect(row<{ status: string; revision: number }>(
      database,
      "SELECT status, revision FROM work_items WHERE id = ?",
      [currentId],
    )).toEqual({ status: "review", revision: 2 });
    expect(row<{ status: string; revision: number }>(
      database,
      "SELECT status, revision FROM work_items WHERE id = ?",
      [requestedId],
    )).toEqual({ status: "focus", revision: 1 });
    expect(row<{ work_item_id: string | null; revision: number }>(
      database,
      "SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1",
    )).toEqual({ work_item_id: requestedId, revision: 2 });

    insertFocusCommand(database, {
      id: `release-${requestedId}`,
      correlationId: `release-correlation-${requestedId}`,
      currentId: requestedId,
      requestedId: null,
      slotRevision: 2,
      currentRevision: 1,
      releaseStatus: "todo",
      checkpoint: "safe stopping point",
      nextAction: "continue the requested task",
    });

    expect(row<{ status: string; revision: number }>(
      database,
      "SELECT status, revision FROM work_items WHERE id = ?",
      [requestedId],
    )).toEqual({ status: "todo", revision: 2 });
    expect(row<{ work_item_id: string | null; revision: number }>(
      database,
      "SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1",
    )).toEqual({ work_item_id: null, revision: 3 });
    expectForeignKeysValid(database);
  });
}

test("a consumed focus command scrubs payloads and rejects correlation replays", () => {
  const database = createDatabase();
  insertWorkItem(database, "current");
  insertWorkItem(database, "requested");
  acquireFocus(database, "current");

  insertFocusCommand(database, {
    id: "swap-command",
    correlationId: "idempotent-correlation",
    currentId: "current",
    requestedId: "requested",
    slotRevision: 1,
    currentRevision: 1,
    requestedRevision: 0,
    releaseStatus: "blocked",
    checkpoint: "sensitive checkpoint",
    nextAction: "sensitive next action",
    blockedReason: "sensitive blocker",
    resumeCondition: "sensitive resume condition",
    nextReviewAt: "2026-08-08T02:00:00.000Z",
  });

  expect(row<Record<string, unknown>>(
    database,
    `SELECT status, checkpoint, next_action, blocked_reason, resume_condition, next_review_at
     FROM work_focus_transition_commands WHERE id = 'swap-command'`,
  )).toEqual({
    status: "consumed",
    checkpoint: null,
    next_action: null,
    blocked_reason: null,
    resume_condition: null,
    next_review_at: null,
  });

  expect(() => insertFocusCommand(database, {
    id: "replayed-command",
    correlationId: "idempotent-correlation",
    currentId: "requested",
    requestedId: null,
    slotRevision: 2,
    currentRevision: 1,
    releaseStatus: "todo",
    checkpoint: "duplicate",
    nextAction: "duplicate",
  })).toThrow();

  expect(row<{ count: number }>(
    database,
    "SELECT count(*) AS count FROM work_focus_transition_commands WHERE correlation_id = 'idempotent-correlation'",
  ).count).toBe(1);
  expect(row<{ work_item_id: string | null }>(
    database,
    "SELECT work_item_id FROM work_focus_slot WHERE slot = 1",
  ).work_item_id).toBe("requested");
});

test("a late failure rolls back every focus command side effect", () => {
  const database = createDatabase();
  insertWorkItem(database, "current");
  insertWorkItem(database, "requested");
  acquireFocus(database, "current");
  const eventCount = row<{ count: number }>(database, "SELECT count(*) AS count FROM activity_events").count;
  database.exec(`
    CREATE TRIGGER test_reject_requested_focus
    BEFORE UPDATE OF status ON work_items
    FOR EACH ROW WHEN NEW.id = 'requested' AND NEW.status = 'focus'
    BEGIN
      SELECT RAISE(ABORT, 'injected_requested_failure');
    END;
  `);

  expect(() => insertFocusCommand(database, {
    id: "failing-swap",
    correlationId: "failing-swap-correlation",
    currentId: "current",
    requestedId: "requested",
    slotRevision: 1,
    currentRevision: 1,
    requestedRevision: 0,
    releaseStatus: "todo",
    checkpoint: "would be persisted without rollback",
    nextAction: "would be persisted without rollback",
  })).toThrow("injected_requested_failure");

  expect(row<{ status: string; revision: number }>(
    database,
    "SELECT status, revision FROM work_items WHERE id = 'current'",
  )).toEqual({ status: "focus", revision: 1 });
  expect(row<{ status: string; revision: number }>(
    database,
    "SELECT status, revision FROM work_items WHERE id = 'requested'",
  )).toEqual({ status: "todo", revision: 0 });
  expect(row<{ work_item_id: string | null; revision: number }>(
    database,
    "SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1",
  )).toEqual({ work_item_id: "current", revision: 1 });
  expect(row<{ count: number }>(
    database,
    "SELECT count(*) AS count FROM work_focus_transition_commands WHERE id = 'failing-swap'",
  ).count).toBe(0);
  expect(row<{ count: number }>(database, "SELECT count(*) AS count FROM activity_events").count).toBe(eventCount);
});

test("focus command CAS rejects stale slot and work item revisions without persisting commands", () => {
  const database = createDatabase();
  insertWorkItem(database, "current");
  insertWorkItem(database, "requested");
  acquireFocus(database, "current");

  expect(() => insertFocusCommand(database, {
    id: "stale-slot",
    correlationId: "stale-slot-correlation",
    currentId: "current",
    requestedId: "requested",
    slotRevision: 0,
    currentRevision: 1,
    requestedRevision: 0,
    releaseStatus: "todo",
    checkpoint: "checkpoint",
    nextAction: "next action",
  })).toThrow("focus_slot_revision_conflict");
  expect(() => insertFocusCommand(database, {
    id: "stale-task",
    correlationId: "stale-task-correlation",
    currentId: "current",
    requestedId: "requested",
    slotRevision: 1,
    currentRevision: 0,
    requestedRevision: 0,
    releaseStatus: "todo",
    checkpoint: "checkpoint",
    nextAction: "next action",
  })).toThrow("current_work_item_revision_conflict");

  expect(row<{ count: number }>(
    database,
    `SELECT count(*) AS count FROM work_focus_transition_commands
     WHERE id IN ('stale-slot', 'stale-task')`,
  ).count).toBe(0);
  expect(row<{ work_item_id: string | null; revision: number }>(
    database,
    "SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1",
  )).toEqual({ work_item_id: "current", revision: 1 });
  expect(row<{ status: string; revision: number }>(
    database,
    "SELECT status, revision FROM work_items WHERE id = 'current'",
  )).toEqual({ status: "focus", revision: 1 });
});

describe("transition guards", () => {
  test("focus command can release an explicitly delegated Task to ai_running", () => {
    const database = createDatabase();
    insertWorkItem(database, "delegated");
    acquireFocus(database, "delegated");
    insertFocusCommand(database, {
      id: "delegate-release",
      correlationId: "delegate-release-correlation",
      currentId: "delegated",
      requestedId: null,
      slotRevision: 1,
      currentRevision: 1,
      requestedRevision: null,
      releaseStatus: "ai_running",
      checkpoint: "Prompt and inputs are ready",
      nextAction: "Review the generated change",
    });
    expect(row<{ status: string }>(
      database,
      "SELECT status FROM work_items WHERE id = 'delegated'",
    ).status).toBe("ai_running");
  });

  test("require revision CAS and structured blocked fields", () => {
    const database = createDatabase();
    insertWorkItem(database, "blocked-candidate");

    expect(() => database.run(
      `UPDATE work_items SET status = 'blocked', revision = revision + 1,
       transition_correlation_id = 'missing-block-data' WHERE id = 'blocked-candidate'`,
    )).toThrow("blocked_requires_reason_and_resume_condition");
    expect(() => database.run(
      `UPDATE work_items SET checkpoint = 'without revision'
       WHERE id = 'blocked-candidate'`,
    )).toThrow("work_item_revision_conflict");

    database.run(
      `UPDATE work_items SET status = 'blocked', blocked_reason = 'Waiting for API',
       resume_condition = 'API is deployed', revision = revision + 1,
       transition_correlation_id = 'valid-block' WHERE id = 'blocked-candidate'`,
    );
    expect(row<{ status: string; blocked_reason: string; revision: number }>(
      database,
      "SELECT status, blocked_reason, revision FROM work_items WHERE id = 'blocked-candidate'",
    )).toEqual({ status: "blocked", blocked_reason: "Waiting for API", revision: 1 });
  });

  test("reject direct focus acquisition and incomplete focus release", () => {
    const database = createDatabase();
    insertWorkItem(database, "focused");
    insertWorkItem(database, "direct-focus");
    acquireFocus(database, "focused");

    expect(() => database.run(
      `UPDATE work_items SET status = 'focus', revision = revision + 1,
       transition_correlation_id = 'not-a-command' WHERE id = 'direct-focus'`,
    )).toThrow("focus_requires_command");
    expect(() => database.run(
      `UPDATE work_items SET status = 'todo', revision = revision + 1,
       transition_correlation_id = 'unsafe-release' WHERE id = 'focused'`,
    )).toThrow("focus_release_requires_checkpoint_and_next_action");
  });
});

test("completion atomically records evidence, completes work, and releases focus", () => {
  const database = createDatabase();
  insertWorkItem(database, "completed-focus");
  acquireFocus(database, "completed-focus");

  database.run(
    `INSERT INTO completion_records(
      id, work_item_id, result_summary, evidence_json, provenance,
      base_work_item_revision, completed_at, created_at
    ) VALUES ('completion-1', 'completed-focus', 'Delivered', '["https://example.test/pr/1"]',
      'user', 1, '2026-08-07T03:00:00.000Z', '2026-08-07T03:00:00.000Z')`,
  );

  expect(row<{ status: string; completed_at: string | null; revision: number }>(
    database,
    "SELECT status, completed_at, revision FROM work_items WHERE id = 'completed-focus'",
  )).toEqual({ status: "done", completed_at: "2026-08-07T03:00:00.000Z", revision: 2 });
  expect(row<{ work_item_id: string | null; revision: number }>(
    database,
    "SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1",
  )).toEqual({ work_item_id: null, revision: 2 });
  expect(row<{ event_type: string; correlation_id: string }>(
    database,
    "SELECT event_type, correlation_id FROM activity_events WHERE work_item_id = 'completed-focus' ORDER BY occurred_at DESC LIMIT 1",
  )).toEqual({ event_type: "task_completed", correlation_id: "completion-1" });

  insertWorkItem(database, "unsafe-done");
  expect(() => database.run(
    `UPDATE work_items SET status = 'done', revision = revision + 1,
     transition_correlation_id = 'unsafe-done' WHERE id = 'unsafe-done'`,
  )).toThrow("done_requires_completion_record");
  expect(row<{ status: string; revision: number }>(
    database,
    "SELECT status, revision FROM work_items WHERE id = 'unsafe-done'",
  )).toEqual({ status: "todo", revision: 0 });
  expectForeignKeysValid(database);
});

function insertExternalAction(database: Database, workItemId: string, id: string, status: string): void {
  database.run(
    `INSERT INTO external_action_requests(
      id, work_item_id, provider, action_kind, external_key, observed_state,
      target_state, transition_id, transition_name, available_transitions_hash,
      preview_hash, idempotency_key, status, created_at, updated_at
    ) VALUES (?, ?, 'jira', 'transition-status', 'ORB-1', 'To Do', 'Done',
      '31', 'Done', 'transitions-hash', 'preview-hash', ?, ?, ?, ?)`,
    [id, workItemId, `idempotency-${id}`, status, "2026-08-07T01:00:00.000Z", "2026-08-07T01:00:00.000Z"],
  );
}

test("deletion retains audit-safe branches and clears or cascades dependent data", () => {
  const database = createDatabase();
  insertWorkItem(database, "deletable");
  database.run(
    `INSERT INTO inbox_candidates(
      id, source, external_key, external_version, title, status, linked_work_item_id,
      discovered_at, updated_at
    ) VALUES ('inbox-1', 'jira', 'ORB-1', 'v1', 'Inbox item', 'linked', 'deletable', ?, ?)`,
    ["2026-08-07T01:00:00.000Z", "2026-08-07T01:00:00.000Z"],
  );
  database.run(
    `INSERT INTO ai_sessions(
      provider, session_id, title, modified_at_ms, acknowledged_at_ms,
      linked_work_item_id, discovered_at, completion_state
    ) VALUES ('codex', 'delete-session', 'Delete session', 1, 1, 'deletable', ?, 'active')`,
    ["2026-08-07T01:00:00.000Z"],
  );
  database.run(
    `INSERT INTO work_item_links(id, work_item_id, kind, external_id, label, created_at)
     VALUES ('delete-link', 'deletable', 'jira', 'ORB-1', 'ORB-1', ?)`,
    ["2026-08-07T01:00:00.000Z"],
  );
  database.run(
    `INSERT INTO task_templates(
      id, title, title_tokens, source_work_item_id, created_at, updated_at
    ) VALUES ('template-1', 'Template', 'template', 'deletable', ?, ?)`,
    ["2026-08-07T01:00:00.000Z", "2026-08-07T01:00:00.000Z"],
  );
  database.run(
    `INSERT INTO work_item_checklist_items(
      id, work_item_id, label, position, created_at
    ) VALUES ('check-1', 'deletable', 'Verify', 0, ?)`,
    ["2026-08-07T01:00:00.000Z"],
  );
  database.run(
    `INSERT INTO activity_events(
      id, work_item_id, event_type, correlation_id, payload_json, occurred_at
    ) VALUES ('event-before-delete', 'deletable', 'context_opened', 'context-1', '{}', ?)`,
    ["2026-08-07T01:00:00.000Z"],
  );
  for (const [id, status] of [
    ["action-succeeded", "succeeded"],
    ["action-cancelled", "cancelled"],
    ["action-draft", "draft"],
    ["action-failed", "failed"],
  ] as const) {
    insertExternalAction(database, "deletable", id, status);
  }

  database.run("DELETE FROM work_items WHERE id = 'deletable'");

  expect(row<{ linked_work_item_id: string | null }>(
    database,
    "SELECT linked_work_item_id FROM ai_sessions WHERE session_id = 'delete-session'",
  ).linked_work_item_id).toBeNull();
  expect(row<{ status: string; linked_work_item_id: string | null }>(
    database,
    "SELECT status, linked_work_item_id FROM inbox_candidates WHERE id = 'inbox-1'",
  )).toEqual({ status: "new", linked_work_item_id: null });
  expect(row<{ source_work_item_id: string | null }>(
    database,
    "SELECT source_work_item_id FROM task_templates WHERE id = 'template-1'",
  ).source_work_item_id).toBeNull();
  expect(row<{ count: number }>(database, "SELECT count(*) AS count FROM work_item_links").count).toBe(0);
  expect(row<{ count: number }>(database, "SELECT count(*) AS count FROM work_item_checklist_items").count).toBe(0);

  expect(rows<{ id: string; work_item_id: string | null }>(
    database,
    "SELECT id, work_item_id FROM external_action_requests ORDER BY id",
  )).toEqual([]);
  const retainedEvents = rows<{ event_type: string; work_item_id: string | null }>(
    database,
    `SELECT event_type, work_item_id FROM activity_events
     WHERE id = 'event-before-delete' OR event_type = 'task_deleted'
     ORDER BY event_type`,
  );
  expect(retainedEvents).toEqual([
    { event_type: "context_opened", work_item_id: null },
    { event_type: "task_deleted", work_item_id: null },
  ]);
  expectForeignKeysValid(database);
});

for (const protectedStatus of ["executing", "needs-reconciliation"] as const) {
  test(`deletion is blocked while an external action is ${protectedStatus}`, () => {
    const database = createDatabase();
    insertWorkItem(database, `protected-${protectedStatus}`);
    insertExternalAction(database, `protected-${protectedStatus}`, `action-${protectedStatus}`, protectedStatus);

    expect(() => database.run(
      "DELETE FROM work_items WHERE id = ?",
      [`protected-${protectedStatus}`],
    )).toThrow("task_has_unreconciled_external_action");
    expect(row<{ count: number }>(
      database,
      "SELECT count(*) AS count FROM work_items WHERE id = ?",
      [`protected-${protectedStatus}`],
    ).count).toBe(1);
    expect(row<{ count: number }>(
      database,
      "SELECT count(*) AS count FROM activity_events WHERE event_type = 'task_deleted'",
    ).count).toBe(0);
    expectForeignKeysValid(database);
  });
}
