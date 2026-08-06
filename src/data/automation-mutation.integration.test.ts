import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const files = readdirSync("src-tauri/migrations").filter((file) => file.endsWith(".sql")).sort();
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function databaseThrough(version = 26): Database {
  const database = new Database(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of files) {
    if (Number(file.slice(0, 4)) <= version) {
      database.exec(readFileSync(`src-tauri/migrations/${file}`, "utf8"));
    }
  }
  return database;
}

function applyMigration(database: Database, version: number): void {
  const file = files.find((candidate) => Number(candidate.slice(0, 4)) === version);
  if (!file) throw new Error(`missing migration ${version}`);
  database.exec(readFileSync(`src-tauri/migrations/${file}`, "utf8"));
}

function insertTask(database: Database, id = "task-1"): void {
  database.run(
    `INSERT INTO work_items(id,title,status,source,created_at,updated_at)
     VALUES (?,?,'todo','orbit','2026-08-07T01:00:00.000Z','2026-08-07T01:00:00.000Z')`,
    [id, `Task ${id}`],
  );
}

function insertCandidate(database: Database, id = "candidate-1", source = "jira"): void {
  database.run(
    `INSERT INTO inbox_candidates(
      id,source,external_key,external_version,title,external_url,status,discovered_at,updated_at
    ) VALUES (?,?,?,'v1','Candidate','https://example.test/item','new',
      '2026-08-07T01:00:00.000Z','2026-08-07T01:00:00.000Z')`,
    [id, source, source === "jira" ? "ORB-1" : "message-1"],
  );
}

function insertRule(database: Database, kind: string, id = `rule-${kind}`): string {
  database.run(
    `INSERT INTO automation_rules(
      id,rule_kind,normalized_source_identity,status,minimum_confidence,
      consecutive_approvals,created_at,updated_at
    ) VALUES (?,?,?,'enabled',1,3,'2026-08-07T01:00:00.000Z','2026-08-07T01:00:00.000Z')`,
    [id, kind, `identity:${kind}`],
  );
  return id;
}

function insertAction(database: Database, input: {
  id: string; ruleId: string; kind: string; recordType: string; recordId: string;
  version: string; payload?: Record<string, unknown> | null;
}): void {
  database.run(
    `INSERT INTO automation_actions(
      id,rule_id,rule_kind,normalized_source_identity,affected_record_type,
      affected_record_id,identity_version,confidence,reason,state,undo_payload_json,
      created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,1,'exact match','executed',?,
      '2026-08-07T02:00:00.000Z','2026-08-07T02:00:00.000Z')`,
    [input.id, input.ruleId, input.kind, `identity:${input.kind}`, input.recordType,
      input.recordId, input.version, input.payload === undefined ? null : JSON.stringify(input.payload)],
  );
}

const candidateSnapshot = {
  candidateId: "candidate-1",
  candidateVersion: "v1",
  priorStatus: "new",
  priorLinkedWorkItemId: null,
  priorIgnoredVersion: null,
};

test("exact Inbox ignore mutates the candidate and atomically restores it on undo", () => {
  const database = databaseThrough();
  insertCandidate(database);
  const ruleId = insertRule(database, "exact-inbox-ignore");
  insertAction(database, {
    id: "ignore-1", ruleId, kind: "exact-inbox-ignore",
    recordType: "inbox_candidate", recordId: "candidate-1", version: "v1",
    payload: candidateSnapshot,
  });
  expect(database.query("SELECT status,ignored_version FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ status: "ignored", ignored_version: "v1" });

  database.run(
    "UPDATE automation_actions SET state='undone',updated_at='2026-08-07T03:00:00.000Z' WHERE id='ignore-1'",
  );
  expect(database.query("SELECT status,linked_work_item_id,ignored_version FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ status: "new", linked_work_item_id: null, ignored_version: null });
  expect(database.query("SELECT state FROM automation_actions WHERE id='ignore-1'").get())
    .toEqual({ state: "undone" });
});

test("exact external link creates and removes only its own local link", () => {
  const database = databaseThrough();
  insertTask(database);
  insertCandidate(database);
  const ruleId = insertRule(database, "exact-external-link");
  insertAction(database, {
    id: "link-action", ruleId, kind: "exact-external-link",
    recordType: "inbox_candidate", recordId: "candidate-1", version: "v1",
    payload: {
      ...candidateSnapshot,
      workItemId: "task-1", source: "jira", externalKey: "ORB-1",
      externalUrl: "https://example.test/item", label: "ORB-1",
      createdLinkId: "auto-link-1", priorAiLinkedWorkItemId: null,
    },
  });
  expect(database.query("SELECT status,linked_work_item_id FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ status: "linked", linked_work_item_id: "task-1" });
  expect(database.query("SELECT id,work_item_id FROM work_item_links WHERE id='auto-link-1'").get())
    .toEqual({ id: "auto-link-1", work_item_id: "task-1" });

  database.run(
    "UPDATE automation_actions SET state='undone',updated_at='2026-08-07T03:00:00.000Z' WHERE id='link-action'",
  );
  expect(database.query("SELECT status,linked_work_item_id FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ status: "new", linked_work_item_id: null });
  expect(database.query("SELECT count(*) AS count FROM work_item_links WHERE id='auto-link-1'").get())
    .toEqual({ count: 0 });
});

test("prepared draft is separate from Task state and discard removes the draft", () => {
  const database = databaseThrough();
  insertTask(database);
  const ruleId = insertRule(database, "prepare-draft");
  insertAction(database, {
    id: "draft-1", ruleId, kind: "prepare-draft",
    recordType: "work_item", recordId: "task-1", version: "0",
    payload: {
      workItemId: "task-1", checkpoint: "API client ready",
      nextAction: "Add integration tests", evidenceJson: "[]",
    },
  });
  expect(database.query("SELECT checkpoint,next_action FROM work_items WHERE id='task-1'").get())
    .toEqual({ checkpoint: null, next_action: null });
  expect(database.query("SELECT checkpoint,next_action FROM automation_prepared_drafts WHERE action_id='draft-1'").get())
    .toEqual({ checkpoint: "API client ready", next_action: "Add integration tests" });
  database.run(
    "UPDATE automation_actions SET state='discarded',updated_at='2026-08-07T03:00:00.000Z' WHERE id='draft-1'",
  );
  expect(database.query("SELECT count(*) AS count FROM automation_prepared_drafts").get())
    .toEqual({ count: 0 });
});

test("legacy missing, null, or empty undo payload never reports success", () => {
  for (const [id, payload] of [
    ["missing", undefined], ["null-json", null], ["empty", {}],
  ] as const) {
    const database = databaseThrough(25);
    insertCandidate(database);
    const ruleId = insertRule(database, "exact-inbox-ignore", `rule-${id}`);
    insertAction(database, {
      id, ruleId, kind: "exact-inbox-ignore", recordType: "inbox_candidate",
      recordId: "candidate-1", version: "v1", payload,
    });
    applyMigration(database, 26);
    expect(() => database.run(
      "UPDATE automation_actions SET state='undone',updated_at='2026-08-07T03:00:00.000Z' WHERE id=?",
      [id],
    )).toThrow();
    expect(database.query("SELECT state FROM automation_actions WHERE id=?").get(id))
      .toEqual({ state: "executed" });
    expect(database.query("SELECT status FROM inbox_candidates WHERE id='candidate-1'").get())
      .toEqual({ status: "new" });
  }
});

test("undo refuses to overwrite a candidate changed after automation", () => {
  const database = databaseThrough();
  insertCandidate(database);
  const ruleId = insertRule(database, "exact-inbox-ignore");
  insertAction(database, {
    id: "ignore-changed", ruleId, kind: "exact-inbox-ignore",
    recordType: "inbox_candidate", recordId: "candidate-1", version: "v1",
    payload: candidateSnapshot,
  });
  database.run("UPDATE inbox_candidates SET external_version='v2',status='new',ignored_version=NULL WHERE id='candidate-1'");
  expect(() => database.run(
    "UPDATE automation_actions SET state='undone',updated_at='2026-08-07T03:00:00.000Z' WHERE id='ignore-changed'",
  )).toThrow("automation_undo_target_changed");
  expect(database.query("SELECT state FROM automation_actions WHERE id='ignore-changed'").get())
    .toEqual({ state: "executed" });
  expect(database.query("SELECT external_version,status FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ external_version: "v2", status: "new" });
});

test("undo refuses to delete an auto-created link changed after automation", () => {
  const database = databaseThrough();
  insertTask(database);
  insertCandidate(database);
  const ruleId = insertRule(database, "exact-external-link");
  insertAction(database, {
    id: "link-changed", ruleId, kind: "exact-external-link",
    recordType: "inbox_candidate", recordId: "candidate-1", version: "v1",
    payload: {
      ...candidateSnapshot,
      workItemId: "task-1", source: "jira", externalKey: "ORB-1",
      externalUrl: "https://example.test/item", label: "ORB-1",
      createdLinkId: "auto-link-changed", priorAiLinkedWorkItemId: null,
    },
  });
  database.run(
    "UPDATE work_item_links SET label='User renamed link',last_synced_at='2026-08-07T02:30:00.000Z' WHERE id='auto-link-changed'",
  );

  expect(() => database.run(
    "UPDATE automation_actions SET state='undone',updated_at='2026-08-07T03:00:00.000Z' WHERE id='link-changed'",
  )).toThrow("automation_undo_child_link_changed");
  expect(database.query("SELECT state FROM automation_actions WHERE id='link-changed'").get())
    .toEqual({ state: "executed" });
  expect(database.query("SELECT label,last_synced_at FROM work_item_links WHERE id='auto-link-changed'").get())
    .toEqual({ label: "User renamed link", last_synced_at: "2026-08-07T02:30:00.000Z" });
  expect(database.query("SELECT status,linked_work_item_id FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ status: "linked", linked_work_item_id: "task-1" });
});

test("undo refuses to overwrite an AI session link changed after automation", () => {
  const database = databaseThrough();
  insertTask(database);
  insertTask(database, "task-2");
  insertCandidate(database, "candidate-1", "ai");
  database.run(
    `INSERT INTO ai_sessions(
      provider,session_id,title,modified_at_ms,acknowledged_at_ms,
      linked_work_item_id,discovered_at,completion_state
    ) VALUES ('codex','session-1','Session',1,1,NULL,
      '2026-08-07T01:00:00.000Z','active')`,
  );
  const ruleId = insertRule(database, "exact-external-link");
  insertAction(database, {
    id: "ai-link-changed", ruleId, kind: "exact-external-link",
    recordType: "inbox_candidate", recordId: "candidate-1", version: "v1",
    payload: {
      ...candidateSnapshot,
      workItemId: "task-1", source: "ai", externalKey: "codex:session-1",
      externalUrl: null, label: "Session", createdLinkId: null,
      priorAiLinkedWorkItemId: null,
    },
  });
  database.run("UPDATE ai_sessions SET linked_work_item_id='task-2' WHERE session_id='session-1'");

  expect(() => database.run(
    "UPDATE automation_actions SET state='undone',updated_at='2026-08-07T03:00:00.000Z' WHERE id='ai-link-changed'",
  )).toThrow("automation_undo_ai_session_changed");
  expect(database.query("SELECT state FROM automation_actions WHERE id='ai-link-changed'").get())
    .toEqual({ state: "executed" });
  expect(database.query("SELECT linked_work_item_id FROM ai_sessions WHERE session_id='session-1'").get())
    .toEqual({ linked_work_item_id: "task-2" });
  expect(database.query("SELECT status,linked_work_item_id FROM inbox_candidates WHERE id='candidate-1'").get())
    .toEqual({ status: "linked", linked_work_item_id: "task-1" });
});
