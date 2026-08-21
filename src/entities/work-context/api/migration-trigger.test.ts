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
  expect(database.query("SELECT name, color FROM planner_categories ORDER BY sort_order").all()).toEqual([
    { name: "업무", color: "#2F8FBF" },
    { name: "할일", color: "#D94B68" },
    { name: "공부", color: "#2B8C87" },
  ]);
  expect(database.query(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type='trigger' AND name LIKE 'daily_plan_entries_%'`).get()).toEqual({ count: 2 });
  database.close();
});

test("planner categories and routines preserve Task ownership", () => {
  const database = migratedDatabase();
  insertTask(database, "planner-task");
  database.query("UPDATE work_items SET category_id='category-work' WHERE id='planner-task'").run();
  database.query(`INSERT INTO planner_routines(
    id, title, category_id, weekdays, reminder_time, created_at, updated_at
  ) VALUES ('routine-1','Daily review','category-work','1,2,3,4,5','09:30','2026-08-11','2026-08-11')`).run();
  database.query(`INSERT INTO planner_routine_occurrences(
    id, routine_id, plan_date, work_item_id, created_at
  ) VALUES ('occurrence-1','routine-1','2026-08-11','planner-task','2026-08-11')`).run();
  expect(database.query(`SELECT w.category_id, r.reminder_time, o.plan_date
    FROM work_items w
    JOIN planner_routine_occurrences o ON o.work_item_id=w.id
    JOIN planner_routines r ON r.id=o.routine_id
    WHERE w.id='planner-task'`).get()).toEqual({
      category_id: "category-work",
      reminder_time: "09:30",
      plan_date: "2026-08-11",
    });
  database.query("DELETE FROM planner_routines WHERE id='routine-1'").run();
  expect(database.query("SELECT routine_id, work_item_id FROM planner_routine_occurrences").get())
    .toEqual({ routine_id: null, work_item_id: "planner-task" });
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  database.close();
});

test("Task workflow documents persist structured progress and follow Task deletion", () => {
  const database = migratedDatabase();
  insertTask(database, "workflow-task");
  database.query(`INSERT INTO work_item_workflows(
    work_item_id, plan_json, progress_json, source_snapshot_json, model,
    generated_at, updated_at
  ) VALUES ('workflow-task', ?, ?, ?, 'gpt-test', '2026-08-21', '2026-08-21')`).run(
    JSON.stringify({ requirementSummary: "요구", frontendImpact: "영향", files: [], implementationChecklist: ["구현"], testChecklist: ["검증"], openQuestions: [] }),
    JSON.stringify({ approvedAt: null, implementationDone: [], questionAnswers: {}, verification: {} }),
    JSON.stringify([{ kind: "jira", label: "CGKR-1", url: null }]),
  );
  expect(database.query("SELECT revision, model FROM work_item_workflows WHERE work_item_id='workflow-task'").get())
    .toEqual({ revision: 1, model: "gpt-test" });
  expect(() => database.query(`UPDATE work_item_workflows SET plan_json='not-json' WHERE work_item_id='workflow-task'`).run())
    .toThrow();
  database.query("DELETE FROM work_items WHERE id='workflow-task'").run();
  expect(database.query("SELECT COUNT(*) AS count FROM work_item_workflows").get()).toEqual({ count: 0 });
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  database.close();
});

test("daily priorities keep at most three ranked tasks per day", () => {
  const database = migratedDatabase();
  for (const id of ["a", "b", "c", "d"]) insertTask(database, id);
  for (const [index, id] of ["a", "b", "c"].entries()) {
    database.query(`INSERT INTO daily_priorities(id, plan_date, work_item_id, rank, created_at, updated_at)
      VALUES (?, '2026-08-11', ?, ?, '2026-08-11', '2026-08-11')`).run(`priority-${id}`, id, index + 1);
  }
  expect(() => database.query(`INSERT INTO daily_priorities(id, plan_date, work_item_id, rank, created_at, updated_at)
    VALUES ('priority-d', '2026-08-11', 'd', 3, '2026-08-11', '2026-08-11')`).run())
    .toThrow("daily_priority_limit_reached");
  database.query("DELETE FROM work_items WHERE id='b'").run();
  expect(database.query("SELECT work_item_id, rank FROM daily_priorities ORDER BY rank").all()).toEqual([
    { work_item_id: "a", rank: 1 },
    { work_item_id: "c", rank: 3 },
  ]);
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  database.close();
});

test("context graph publishes complete immutable generations and safely prunes only old ones", () => {
  const database = migratedDatabase();
  database.query(`INSERT INTO context_graph_generations(
    id, schema_version, source_fingerprint, started_at
  ) VALUES ('g1', 1, 'fingerprint-1', '2026-08-09T01:00:00.000Z')`).run();
  database.query(`INSERT INTO context_graph_nodes(
    generation_id, id, node_type, source_type, source_id, label
  ) VALUES ('g1', 'task:t1', 'task', 'task', 't1', 'Task 1')`).run();
  database.query(`UPDATE context_graph_generations SET
    status='ready', completed_at='2026-08-09T01:00:01.000Z', node_count=1, edge_count=0
    WHERE id='g1'`).run();
  expect(database.query("SELECT current_generation_id, node_count FROM context_graph_index_state WHERE id=1").get())
    .toEqual({ current_generation_id: "g1", node_count: 1 });
  expect(() => database.query("UPDATE context_graph_nodes SET label='changed' WHERE generation_id='g1'").run())
    .toThrow("context_graph_generation_not_building");
  expect(() => database.query("DELETE FROM context_graph_generations WHERE id='g1'").run())
    .toThrow("context_graph_current_generation_cannot_be_pruned");

  database.query(`INSERT INTO context_graph_generations(
    id, schema_version, source_fingerprint, started_at
  ) VALUES ('g2', 1, 'fingerprint-2', '2026-08-09T02:00:00.000Z')`).run();
  database.query(`INSERT INTO context_graph_nodes(
    generation_id, id, node_type, source_type, source_id, label
  ) VALUES ('g2', 'task:t1', 'task', 'task', 't1', 'Task 1 updated')`).run();
  database.query(`UPDATE context_graph_generations SET
    status='ready', completed_at='2026-08-09T02:00:01.000Z', node_count=1, edge_count=0
    WHERE id='g2'`).run();
  database.query("DELETE FROM context_graph_generations WHERE id='g1'").run();
  expect(database.query("SELECT id FROM context_graph_generations").all()).toEqual([{ id: "g2" }]);
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
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

test("daily planner follows completion and reopen status changes", () => {
  const database = migratedDatabase();
  insertTask(database, "a");
  database.query(`INSERT INTO daily_plan_entries(
    id, work_item_id, plan_date, sort_order, state, created_at, updated_at
  ) VALUES (
    'plan-a', 'a', '2026-08-11', 0, 'planned',
    '2026-08-11T01:00:00.000Z', '2026-08-11T01:00:00.000Z'
  )`).run();

  database.query(`INSERT INTO completion_records(
    id, work_item_id, result_summary, provenance, state, base_work_item_revision,
    completed_at, created_at
  ) VALUES (
    'done-a', 'a', 'Delivered', 'user', 'active', 0,
    '2026-08-11T02:00:00.000Z', '2026-08-11T02:00:00.000Z'
  )`).run();

  expect(database.query("SELECT status FROM work_items WHERE id='a'").get())
    .toEqual({ status: "done" });
  expect(database.query("SELECT state FROM daily_plan_entries WHERE id='plan-a'").get())
    .toEqual({ state: "completed" });

  database.query(`UPDATE work_items
    SET status='todo', revision=revision+1, updated_at='2026-08-11T03:00:00.000Z'
    WHERE id='a'`).run();

  expect(database.query("SELECT state FROM daily_plan_entries WHERE id='plan-a'").get())
    .toEqual({ state: "planned" });
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
