import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkItem } from "../../../entities/work-context/model/work-item";
import { buildContinuityDashboard } from "../../../features/tasks/work-continuity";
import { dashboardTaskBuckets } from "../../../entities/work-context/api/dashboard-repository";

const TASK_COUNT = 1_000;
const EVENT_COUNT = 20_000;
const INBOX_COUNT = 5_000;
const QUERY_TARGET_MS = 200;
const fixtureNow = new Date("2026-08-07T09:00:00.000Z");

interface WorkItemRow {
  id: string;
  title: string;
  status: WorkItem["status"];
  priority: WorkItem["priority"];
  source: WorkItem["source"];
  external_id: string | null;
  external_url: string | null;
  goal: string | null;
  checkpoint: string | null;
  next_action: string | null;
  done_definition: string | null;
  blocked_reason: string | null;
  resume_condition: string | null;
  paused_at: string | null;
  last_focused_at: string | null;
  next_review_at: string | null;
  revision: number;
  target_at: string | null;
  reminder_sent_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const workItemFields = `
  id, title, status, priority, source, external_id, external_url,
  goal, checkpoint, next_action, done_definition, blocked_reason, resume_condition,
  paused_at, last_focused_at, next_review_at, revision, target_at, reminder_sent_at,
  position, created_at, updated_at, completed_at
`;

const dashboardSql = `
  SELECT ${workItemFields}
  FROM work_items
  ORDER BY
    CASE status
      WHEN 'focus' THEN 0 WHEN 'review' THEN 1 WHEN 'ai_running' THEN 2
      WHEN 'todo' THEN 3 WHEN 'blocked' THEN 4 WHEN 'inbox' THEN 5 WHEN 'done' THEN 6
    END,
    position ASC, created_at DESC, id DESC
`;

const historySql = `
  SELECT c.id, c.work_item_id, c.result_summary, c.decisions,
    c.remaining_risk, c.retrospective, c.jira_project_key, c.evidence_json,
    c.provenance, c.state, c.base_work_item_revision, c.superseded_at,
    c.completed_at, c.created_at, w.title AS work_item_title, w.status AS work_item_status
  FROM completion_records c JOIN work_items w ON w.id = c.work_item_id
  WHERE (lower(w.title) LIKE ? OR lower(c.result_summary) LIKE ?
    OR lower(c.decisions) LIKE ? OR lower(c.remaining_risk) LIKE ?
    OR lower(c.retrospective) LIKE ? OR lower(c.evidence_json) LIKE ?)
    AND c.completed_at >= ? AND c.jira_project_key = ?
    AND c.evidence_json LIKE ? AND c.state = ?
  ORDER BY c.completed_at DESC, c.id DESC LIMIT 200 OFFSET 0
`;

let database: Database;

beforeAll(() => {
  database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = resolve(import.meta.dir, "../../../../src-tauri/migrations");
  for (const file of readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    database.exec(readFileSync(resolve(migrationDirectory, file), "utf8"));
  }
  seedStandardFixture(database);
});

afterAll(() => database.close());

function seedStandardFixture(target: Database): void {
  const insertTask = target.prepare(`INSERT INTO work_items(
    id, title, status, priority, source, external_id, external_url, goal,
    checkpoint, next_action, done_definition, blocked_reason, resume_condition,
    paused_at, last_focused_at, next_review_at, revision, target_at,
    position, created_at, updated_at, completed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertLink = target.prepare(`INSERT INTO work_item_links(
    id, work_item_id, kind, external_id, external_url, label, status, last_synced_at, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`);
  const insertCompletion = target.prepare(`INSERT INTO completion_records(
    id, work_item_id, result_summary, decisions, remaining_risk, retrospective,
    jira_project_key, evidence_json, provenance, base_work_item_revision,
    state, completed_at, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertEvent = target.prepare(`INSERT INTO activity_events(
    id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at
  ) VALUES (?,?,?,?,?,?,?)`);
  const insertInbox = target.prepare(`INSERT INTO inbox_candidates(
    id, source, external_key, external_version, title, metadata_json,
    status, discovered_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`);
  const statuses: WorkItem["status"][] = ["todo", "review", "ai_running", "blocked", "done"];
  const eventTypes = ["checkpoint_updated", "next_action_updated", "context_opened", "status_advanced"];
  const startedAt = Date.parse("2026-07-01T00:00:00.000Z");

  target.transaction(() => {
    for (let index = 0; index < TASK_COUNT; index += 1) {
      const id = `task-${index.toString().padStart(4, "0")}`;
      const status = statuses[index % statuses.length];
      const timestamp = new Date(startedAt + index * 60_000).toISOString();
      const pausedAt = status === "done" ? null : timestamp;
      const completedAt = status === "done" ? timestamp : null;
      insertTask.run(
        id, `Resume performance task ${index}`, status, index % 3 === 0 ? "p1" : null,
        "orbit", null, null, `Goal ${index}`, `Checkpoint ${index}`,
        `Next action ${index}`, `Done definition ${index}`,
        status === "blocked" ? `Blocked reason ${index}` : null,
        status === "blocked" ? `Resume condition ${index}` : null,
        pausedAt, pausedAt, null, 0,
        index % 4 === 0 ? "2026-08-07T12:00:00.000Z" : null,
        index, timestamp, timestamp, completedAt,
      );
      insertLink.run(
        `link-${index}`, id, "github_pr", `PR-${index}`,
        `https://example.test/pull/${index}`, `Evidence PR ${index}`, "linked", timestamp, timestamp,
      );
      insertCompletion.run(
        `completion-${index}`, id, `Result ${index}`, `Decision resume path ${index}`,
        `Risk ${index}`, `Retrospective ${index}`, index % 2 === 0 ? "ORB" : "APP",
        JSON.stringify([{ source: "github_pr", sourceId: `PR-${index}`, label: `Evidence PR ${index}`, url: `https://example.test/pull/${index}` }]),
        "user", 0, "superseded", timestamp, timestamp,
      );
    }

    for (let index = 0; index < EVENT_COUNT; index += 1) {
      const workItemIndex = index % TASK_COUNT;
      insertEvent.run(
        `event-${index}`, `task-${workItemIndex.toString().padStart(4, "0")}`,
        eventTypes[index % eventTypes.length], `correlation-${Math.floor(index / 2)}`,
        index % 5 === 0 ? "jira" : "orbit", JSON.stringify({ revision: index % 7 }),
        new Date(startedAt + index * 1_000).toISOString(),
      );
    }

    for (let index = 0; index < INBOX_COUNT; index += 1) {
      const source = index % 3 === 0 ? "jira" : index % 3 === 1 ? "slack" : "ai";
      const timestamp = new Date(startedAt + index * 1_000).toISOString();
      insertInbox.run(
        `inbox-${index}`, source, `external-${index}`, "v1", `Inbox candidate ${index}`,
        "{}", "new", timestamp, timestamp,
      );
    }
  })();

  expect(target.query("PRAGMA foreign_key_check").all()).toEqual([]);
}

function mapWorkItem(item: WorkItemRow): WorkItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    source: item.source,
    externalId: item.external_id,
    externalUrl: item.external_url,
    goal: item.goal,
    checkpoint: item.checkpoint,
    nextAction: item.next_action,
    doneDefinition: item.done_definition,
    blockedReason: item.blocked_reason,
    resumeCondition: item.resume_condition,
    pausedAt: item.paused_at,
    lastFocusedAt: item.last_focused_at,
    nextReviewAt: item.next_review_at,
    revision: item.revision,
    targetAt: item.target_at,
    reminderSentAt: item.reminder_sent_at,
    position: item.position,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    completedAt: item.completed_at,
  };
}

function measuredTrials(label: string, action: () => void, trials = 7): number[] {
  for (let warmup = 0; warmup < 3; warmup += 1) action();
  const samples: number[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const started = performance.now();
    action();
    samples.push(performance.now() - started);
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const median = ordered[Math.floor(ordered.length / 2)];
  console.info(`[performance] ${label}`, JSON.stringify({ samplesMs: samples.map((value) => Number(value.toFixed(2))), medianMs: Number(median.toFixed(2)), targetMs: QUERY_TARGET_MS }));
  return samples;
}

function median(samples: number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

describe("1,000 Task / 20,000 activity event acceptance fixture", () => {
  test("contains the documented fixture cardinality", () => {
    expect(database.query("SELECT count(*) AS count FROM work_items").get()).toEqual({ count: TASK_COUNT });
    expect(database.query("SELECT count(*) AS count FROM activity_events").get()).toEqual({ count: EVENT_COUNT });
    expect(database.query("SELECT count(*) AS count FROM inbox_candidates").get()).toEqual({ count: INBOX_COUNT });
  });

  test("Dashboard query, mapping, and continuity preparation stay below 200ms median", () => {
    const samples = measuredTrials("dashboard-query-and-preparation", () => {
      const tasks = (database.query(dashboardSql).all() as WorkItemRow[]).map(mapWorkItem);
      const dashboard = dashboardTaskBuckets(tasks, fixtureNow);
      const continuity = buildContinuityDashboard(tasks, fixtureNow);
      expect(tasks).toHaveLength(TASK_COUNT);
      expect(dashboard.todayTasks.length).toBeGreaterThan(0);
      expect(continuity.resume?.checkpoint).toBeTruthy();
    });
    expect(median(samples)).toBeLessThan(QUERY_TARGET_MS);
  });

  test("History filtered search stays below 200ms median", () => {
    const parameters = [
      "%resume%", "%resume%", "%resume%", "%resume%", "%resume%", "%resume%",
      "2026-07-01T00:00:00.000Z", "ORB", "%\"source\":\"github_pr\"%", "superseded",
    ];
    const samples = measuredTrials("history-filtered-search", () => {
      const results = database.query(historySql).all(...parameters) as Array<{ id: string; evidence_json: string }>;
      expect(results.length).toBeGreaterThan(0);
      expect(JSON.parse(results[0].evidence_json)[0].source).toBe("github_pr");
    });
    expect(median(samples)).toBeLessThan(QUERY_TARGET_MS);
  });

  test("three warm-cache no-focus resume data-path trials stay below 200ms each", () => {
    const samples: number[] = [];
    for (let trial = 0; trial < 3; trial += 1) {
      database.exec(`SAVEPOINT resume_trial_${trial}`);
      try {
        const started = performance.now();
        const tasks = (database.query(dashboardSql).all() as WorkItemRow[]).map(mapWorkItem);
        const candidate = buildContinuityDashboard(tasks, fixtureNow).resume;
        expect(candidate).toBeTruthy();
        const slot = database.query("SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1").get() as { work_item_id: string | null; revision: number };
        expect(slot.work_item_id).toBeNull();
        database.query(`INSERT INTO work_focus_transition_commands(
          id, correlation_id, current_work_item_id, requested_work_item_id,
          expected_slot_revision, expected_current_revision, expected_requested_revision,
          status, created_at
        ) VALUES (?, ?, NULL, ?, ?, NULL, ?, 'pending', ?)`)
          .run(`resume-command-${trial}`, `resume-trial-${trial}`, candidate!.id, slot.revision, candidate!.revision, fixtureNow.toISOString());
        const drawer = database.query(`SELECT w.checkpoint, w.next_action, l.external_url
          FROM work_items w JOIN work_item_links l ON l.work_item_id = w.id
          WHERE w.id = ? ORDER BY l.created_at DESC LIMIT 1`).get(candidate!.id) as {
            checkpoint: string | null;
            next_action: string | null;
            external_url: string | null;
          };
        samples.push(performance.now() - started);
        expect(drawer.checkpoint).toBeTruthy();
        expect(drawer.next_action).toBeTruthy();
        expect(drawer.external_url).toStartWith("https://");
      } finally {
        database.exec(`ROLLBACK TO resume_trial_${trial}`);
        database.exec(`RELEASE resume_trial_${trial}`);
      }
    }
    console.info("[performance] resume-data-path-three-trials", JSON.stringify({ samplesMs: samples.map((value) => Number(value.toFixed(2))), targetMs: QUERY_TARGET_MS }));
    expect(samples).toHaveLength(3);
    expect(Math.max(...samples)).toBeLessThan(QUERY_TARGET_MS);
  });

  test("query plans use time, source-scope, and work-item indexes", () => {
    const activityPlan = database.query(`EXPLAIN QUERY PLAN
      SELECT * FROM activity_events WHERE work_item_id = ? AND occurred_at >= ?
      ORDER BY occurred_at DESC LIMIT 100`).all("task-0001", "2026-07-01T00:00:00.000Z") as Array<{ detail: string }>;
    const historyPlan = database.query(`EXPLAIN QUERY PLAN
      SELECT c.id FROM completion_records c JOIN work_items w ON w.id = c.work_item_id
      WHERE c.completed_at >= ? ORDER BY c.completed_at DESC LIMIT 100`)
      .all("2026-07-01T00:00:00.000Z") as Array<{ detail: string }>;
    const sourcePlan = database.query(`EXPLAIN QUERY PLAN
      SELECT * FROM source_sync_state WHERE source = ? AND scope_key = ?`)
      .all("jira", "global") as Array<{ detail: string }>;
    const details = [...activityPlan, ...historyPlan, ...sourcePlan].map(({ detail }) => detail).join("\n");

    expect(details).toContain("activity_events_work_item_time");
    expect(details).toContain("completion_records_history");
    expect(details).toContain("sqlite_autoindex_source_sync_state_1");
  });
});
