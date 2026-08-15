import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrbitRepository } from "./orbit-repository";

let testDirectory = "";
let databasePath = "";

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "orbit-mcp-"));
  databasePath = join(testDirectory, "orbit.db");
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE work_items (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      status TEXT NOT NULL,
      priority TEXT,
      source TEXT NOT NULL,
      goal TEXT,
      next_action TEXT,
      done_definition TEXT,
      target_at TEXT,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE jira_issues (
      issue_key TEXT PRIMARY KEY NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      status_category TEXT NOT NULL,
      priority TEXT,
      project_key TEXT NOT NULL,
      project_name TEXT NOT NULL,
      due_date TEXT,
      updated_at TEXT NOT NULL,
      url TEXT NOT NULL,
      discovered_at TEXT NOT NULL
    );
    CREATE TABLE work_item_links (
      id TEXT PRIMARY KEY NOT NULL,
      work_item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'linked',
      last_synced_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  database.close();
});

afterEach(() => rmSync(testDirectory, { recursive: true, force: true }));

describe("OrbitRepository", () => {
  test("creates and reads a task without touching the production database", () => {
    const repository = new OrbitRepository({ databasePath });
    const task = repository.createTask({
      title: "  MCP 할 일 만들기  ",
      goal: "터미널에서 Orbit을 사용한다",
      priority: "p1",
      targetAt: "2026-08-16T09:00:00+09:00",
    });

    expect(task.title).toBe("MCP 할 일 만들기");
    expect(task.status).toBe("todo");
    expect(task.priority).toBe("p1");
    expect(task.targetAt).toBe("2026-08-16T00:00:00.000Z");
    expect(repository.listTasks({ query: "MCP" })).toHaveLength(1);
    repository.close();
  });

  test("lists cached assigned Jira tickets with linked Orbit tasks", () => {
    const database = new Database(databasePath);
    database.exec(`
      INSERT INTO work_items (id, title, status, priority, source, position, created_at, updated_at)
      VALUES ('task-1', 'Sentry 연결', 'todo', NULL, 'orbit', 0, '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z');
      INSERT INTO jira_issues (
        issue_key, summary, status, status_category, priority, project_key, project_name,
        due_date, updated_at, url, discovered_at
      ) VALUES (
        'CGKR-2492', 'PDA Sentry 구축', '리뷰중', 'In Progress', 'High', 'CGKR', 'CGKR',
        NULL, '2026-08-15T00:00:00Z', 'https://example.atlassian.net/browse/CGKR-2492', '2026-08-15T00:00:00Z'
      );
      INSERT INTO work_item_links (id, work_item_id, kind, external_id, label, created_at)
      VALUES ('link-1', 'task-1', 'jira', 'CGKR-2492', 'CGKR-2492', '2026-08-15T00:00:00Z');
    `);
    database.close();

    const repository = new OrbitRepository({ databasePath, readOnly: true });
    const tickets = repository.listMyTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.key).toBe("CGKR-2492");
    expect(tickets[0]?.linkedTasks[0]?.title).toBe("Sentry 연결");
    repository.close();
  });

  test("blocks mutations in read-only mode", () => {
    const repository = new OrbitRepository({ databasePath, readOnly: true });
    expect(() => repository.createTask({ title: "생성하면 안 됨" })).toThrow("READ_ONLY");
    repository.close();
  });
});
