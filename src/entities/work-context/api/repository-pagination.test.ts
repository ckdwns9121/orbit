import { afterEach, describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { queryCompletedWorkPage } from "./completion-repository";
import { queryInboxCandidatesPage } from "./inbox-repository";

const databases: Database[] = [];

function readAdapter(database: Database) {
  return {
    async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
      return database.query(query).all(...bindValues as SQLQueryBindings[]) as T;
    },
  };
}

function openDatabase(): Database {
  const database = new Database(":memory:");
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("repository-backed pagination", () => {
  test("Inbox rows after the former 500-row cap remain reachable", async () => {
    const database = openDatabase();
    database.exec(`CREATE TABLE inbox_candidates (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_key TEXT NOT NULL,
      external_version TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT,
      external_url TEXT,
      metadata_json TEXT NOT NULL,
      status TEXT NOT NULL,
      linked_work_item_id TEXT,
      ignored_version TEXT,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    const insert = database.prepare(`INSERT INTO inbox_candidates(
      id, source, external_key, external_version, title, metadata_json,
      status, discovered_at, updated_at
    ) VALUES (?, 'jira', ?, 'v1', ?, '{}', ?, ?, ?)`);
    database.transaction(() => {
      for (let index = 0; index < 521; index += 1) {
        const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
        insert.run(`inbox-${index}`, `issue-${index}`, `Candidate ${index}`, index === 0 ? "ignored" : "new", timestamp, timestamp);
      }
    })();

    const page = await queryInboxCandidatesPage(readAdapter(database), "new", {
      limit: 20,
      offset: 500,
    });

    expect(page.total).toBe(520);
    expect(page.offset).toBe(500);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]?.id).toBe("inbox-20");
    expect(page.items[page.items.length - 1]?.id).toBe("inbox-1");
  });

  test("filtered completion rows after the former 200-row cap remain reachable", async () => {
    const database = openDatabase();
    database.exec(`
      CREATE TABLE work_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE completion_records (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        result_summary TEXT NOT NULL,
        decisions TEXT NOT NULL,
        remaining_risk TEXT NOT NULL,
        retrospective TEXT NOT NULL,
        jira_project_key TEXT,
        evidence_json TEXT NOT NULL,
        provenance TEXT NOT NULL,
        state TEXT NOT NULL,
        base_work_item_revision INTEGER NOT NULL,
        superseded_at TEXT,
        completed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const insertTask = database.prepare("INSERT INTO work_items(id, title, status) VALUES (?, ?, 'done')");
    const insertCompletion = database.prepare(`INSERT INTO completion_records(
      id, work_item_id, result_summary, decisions, remaining_risk, retrospective,
      jira_project_key, evidence_json, provenance, state, base_work_item_revision,
      completed_at, created_at
    ) VALUES (?, ?, ?, 'Decision', 'Risk', 'Retro', 'ORB', ?, 'user', 'active', 0, ?, ?)`);
    database.transaction(() => {
      for (let index = 0; index < 221; index += 1) {
        const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
        const taskId = `task-${index}`;
        insertTask.run(taskId, `Searchable task ${index}`);
        insertCompletion.run(
          `completion-${index}`,
          taskId,
          `Result ${index}`,
          JSON.stringify([{ source: "github_pr", sourceId: `pr-${index}`, label: "PR", url: null }]),
          timestamp,
          timestamp,
        );
      }
    })();

    const page = await queryCompletedWorkPage(readAdapter(database), {
      query: "searchable",
      jiraProjectKey: "orb",
      source: "github_pr",
      state: "active",
      limit: 20,
      offset: 200,
    });

    expect(page.total).toBe(221);
    expect(page.offset).toBe(200);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]?.id).toBe("completion-20");
    expect(page.items[page.items.length - 1]?.id).toBe("completion-1");
  });
});
