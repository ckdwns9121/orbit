import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";

function migratedDatabase(): Database {
  const database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("src-tauri/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(`src-tauri/migrations/${file}`, "utf8"));
  }
  return database;
}

function insertTask(database: Database, id: string): void {
  database.query(`INSERT INTO work_items(
    id, title, status, source, position, created_at, updated_at
  ) VALUES (?, ?, 'todo', 'orbit', 0, ?, ?)`)
    .run(id, `Task ${id}`, "2026-08-06T01:00:00.000Z", "2026-08-06T01:00:00.000Z");
}

test("all migrations apply with foreign key integrity", () => {
  const database = migratedDatabase();
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(database.query("SELECT revision FROM work_items").all()).toEqual([]);
  database.close();
});

test("transition guards and activity append are atomic", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  expect(() => database.query(`UPDATE work_items SET status = 'blocked', revision = revision + 1,
    transition_correlation_id = 'bad', updated_at = '2026-08-06T02:00:00.000Z' WHERE id = 'a'`).run())
    .toThrow("blocked_requires_reason_and_resume_condition");
  expect(database.query("SELECT status, revision FROM work_items WHERE id = 'a'").get())
    .toEqual({ status: "todo", revision: 0 });
  expect(database.query("SELECT COUNT(*) AS count FROM activity_events").get()).toEqual({ count: 0 });

  database.query(`UPDATE work_items SET status = 'blocked', blocked_reason = 'API failure',
    resume_condition = 'staging healthy', revision = revision + 1,
    transition_correlation_id = 'block-a', updated_at = '2026-08-06T02:00:00.000Z'
    WHERE id = 'a' AND revision = 0`).run();
  expect(database.query("SELECT status, revision FROM work_items WHERE id = 'a'").get())
    .toEqual({ status: "blocked", revision: 1 });
  expect(database.query("SELECT event_type, correlation_id FROM activity_events").get())
    .toEqual({ event_type: "task_blocked", correlation_id: "block-a" });
  database.close();
});

test("focus command swaps tasks with one correlation and rejects stale revisions", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  insertTask(database, "b");
  database.query(`INSERT INTO work_focus_transition_commands(
    id, correlation_id, current_work_item_id, requested_work_item_id,
    expected_slot_revision, expected_current_revision, expected_requested_revision,
    status, created_at
  ) VALUES ('c1','focus-a',NULL,'a',0,NULL,0,'pending','2026-08-06T02:00:00.000Z')`).run();
  expect(database.query("SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1").get())
    .toEqual({ work_item_id: "a", revision: 1 });

  database.query(`INSERT INTO work_focus_transition_commands(
    id, correlation_id, current_work_item_id, requested_work_item_id,
    expected_slot_revision, expected_current_revision, expected_requested_revision,
    release_status, checkpoint, next_action, status, created_at
  ) VALUES ('c2','swap-a-b','a','b',1,1,0,'todo','API mapper done','add tests',
    'pending','2026-08-06T03:00:00.000Z')`).run();
  expect(database.query("SELECT id, status, revision FROM work_items ORDER BY id").all()).toEqual([
    { id: "a", status: "todo", revision: 2 },
    { id: "b", status: "focus", revision: 1 },
  ]);
  expect(database.query("SELECT COUNT(*) AS count FROM activity_events WHERE correlation_id = 'swap-a-b'").get())
    .toEqual({ count: 2 });
  expect(database.query("SELECT status, checkpoint, next_action FROM work_focus_transition_commands WHERE id = 'c2'").get())
    .toEqual({ status: "consumed", checkpoint: null, next_action: null });
  expect(() => database.query(`INSERT INTO work_focus_transition_commands(
    id, correlation_id, current_work_item_id, requested_work_item_id,
    expected_slot_revision, expected_current_revision, expected_requested_revision,
    release_status, checkpoint, next_action, status, created_at
  ) VALUES ('stale','stale-command','b','a',1,1,2,'todo','x','y','pending',
    '2026-08-06T04:00:00.000Z')`).run()).toThrow("focus_slot_revision_conflict");
  expect(database.query("SELECT COUNT(*) AS count FROM work_focus_transition_commands WHERE id = 'stale'").get())
    .toEqual({ count: 0 });
  database.close();
});

test("completion episode clears focus and direct done is rejected", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  database.query(`INSERT INTO work_focus_transition_commands(
    id, correlation_id, requested_work_item_id, expected_slot_revision,
    expected_requested_revision, status, created_at
  ) VALUES ('focus','focus-a','a',0,0,'pending','2026-08-06T02:00:00.000Z')`).run();
  expect(() => database.query(`UPDATE work_items SET status='done', revision=revision+1,
    updated_at='2026-08-06T03:00:00.000Z' WHERE id='a'`).run()).toThrow("done_requires_completion_record");
  database.query(`INSERT INTO completion_records(
    id, work_item_id, result_summary, provenance, state, base_work_item_revision,
    completed_at, created_at
  ) VALUES ('done-a','a','Delivered','user','active',1,
    '2026-08-06T03:00:00.000Z','2026-08-06T03:00:00.000Z')`).run();
  expect(database.query("SELECT status, revision FROM work_items WHERE id='a'").get())
    .toEqual({ status: "done", revision: 2 });
  expect(database.query("SELECT work_item_id, revision FROM work_focus_slot WHERE slot=1").get())
    .toEqual({ work_item_id: null, revision: 2 });
  expect(database.query("SELECT event_type, correlation_id FROM activity_events WHERE correlation_id='done-a'").get())
    .toEqual({ event_type: "task_completed", correlation_id: "done-a" });
  database.close();
});

test("suggestion apply is revision-bound and older suggestions become stale", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  database.query(`INSERT INTO status_suggestions(
    id, work_item_id, source, proposed_status, base_status, base_work_item_revision,
    reason, observed_at, state, created_at
  ) VALUES ('s1','a','ai','review','todo',0,'all sessions done',
    '2026-08-06T02:00:00.000Z','pending','2026-08-06T02:00:00.000Z')`).run();
  database.query(`UPDATE work_items SET status='review', revision=revision+1,
    transition_correlation_id='s1', updated_at='2026-08-06T02:01:00.000Z'
    WHERE id='a' AND revision=0`).run();
  expect(database.query("SELECT state FROM status_suggestions WHERE id='s1'").get())
    .toEqual({ state: "applied" });

  database.query(`INSERT INTO status_suggestions(
    id, work_item_id, source, proposed_status, base_status, base_work_item_revision,
    reason, observed_at, state, created_at
  ) VALUES ('s2','a','jira','todo','review',1,'jira changed',
    '2026-08-06T03:00:00.000Z','pending','2026-08-06T03:00:00.000Z')`).run();
  database.query(`UPDATE work_items SET status='ai_running', revision=revision+1,
    transition_correlation_id='user-change', updated_at='2026-08-06T03:01:00.000Z'
    WHERE id='a' AND revision=1`).run();
  expect(database.query("SELECT state FROM status_suggestions WHERE id='s2'").get())
    .toEqual({ state: "stale" });
  database.close();
});

test("hard delete blocks unresolved actions and follows retention policy", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  database.query(`INSERT INTO external_action_requests(
    id, work_item_id, provider, action_kind, external_key, observed_state, target_state,
    transition_id, transition_name, available_transitions_hash, preview_hash,
    idempotency_key, status, created_at, updated_at
  ) VALUES ('x','a','jira','transition-status','CGKR-1','{}','{}','31','Done',
    'transitions','preview','idem','executing','2026-08-06T01:00:00.000Z','2026-08-06T01:00:00.000Z')`).run();
  expect(() => database.query("DELETE FROM work_items WHERE id='a'").run())
    .toThrow("task_has_unreconciled_external_action");
  database.query("UPDATE external_action_requests SET status='failed' WHERE id='x'").run();
  database.query("DELETE FROM work_items WHERE id='a'").run();
  expect(database.query("SELECT COUNT(*) AS count FROM external_action_requests").get()).toEqual({ count: 0 });
  expect(database.query("SELECT work_item_id, event_type FROM activity_events WHERE event_type='task_deleted'").get())
    .toEqual({ work_item_id: null, event_type: "task_deleted" });
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  database.close();
});

test("Inbox and external-action state changes append audit events in the same statement", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  database.query(`INSERT INTO inbox_candidates(
    id, source, external_key, external_version, title, status, discovered_at, updated_at
  ) VALUES ('i','jira','ORB-1','v1','Issue','new',
    '2026-08-06T01:00:00.000Z','2026-08-06T01:00:00.000Z')`).run();
  database.query(`UPDATE inbox_candidates SET status='linked', linked_work_item_id='a',
    updated_at='2026-08-06T02:00:00.000Z' WHERE id='i'`).run();
  expect(database.query("SELECT event_type FROM activity_events WHERE source='jira'").get())
    .toEqual({ event_type: "inbox_linked" });

  database.query(`INSERT INTO external_action_requests(
    id, work_item_id, provider, action_kind, external_key, observed_state, target_state,
    transition_id, transition_name, available_transitions_hash, preview_hash,
    idempotency_key, status, created_at, updated_at
  ) VALUES ('x','a','jira','transition-status','ORB-1','{}','{}','31','Done',
    'transitions','preview','idem','draft','2026-08-06T01:00:00.000Z','2026-08-06T01:00:00.000Z')`).run();
  database.query(`UPDATE external_action_requests SET status='awaiting-approval',
    updated_at='2026-08-06T03:00:00.000Z' WHERE id='x'`).run();
  expect(database.query("SELECT event_type, correlation_id FROM activity_events WHERE correlation_id='x'").get())
    .toEqual({ event_type: "external_action_changed", correlation_id: "x" });
  database.close();
});
