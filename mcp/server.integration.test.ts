import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDirectory = "";
let databasePath = "";

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "orbit-mcp-protocol-"));
  databasePath = join(testDirectory, "orbit.db");
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE work_items (
      id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
      priority TEXT, source TEXT NOT NULL, goal TEXT, next_action TEXT,
      done_definition TEXT, target_at TEXT, position INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE jira_issues (
      issue_key TEXT PRIMARY KEY NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL,
      status_category TEXT NOT NULL, priority TEXT, project_key TEXT NOT NULL,
      project_name TEXT NOT NULL, due_date TEXT, updated_at TEXT NOT NULL,
      url TEXT NOT NULL, discovered_at TEXT NOT NULL
    );
    CREATE TABLE work_item_links (
      id TEXT PRIMARY KEY NOT NULL, work_item_id TEXT NOT NULL, kind TEXT NOT NULL,
      external_id TEXT, external_url TEXT, label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'linked', last_synced_at TEXT, created_at TEXT NOT NULL
    );
  `);
  database.close();
});

afterEach(() => rmSync(testDirectory, { recursive: true, force: true }));

describe("Orbit MCP protocol", () => {
  test("discovers tools and creates a task over stdio", async () => {
    const client = new Client({ name: "orbit-test", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", process.env.ORBIT_MCP_ENTRY || join(import.meta.dir, "server.ts")],
      env: { ...process.env, ORBIT_DB_PATH: databasePath },
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "create_task",
        "list_my_tickets",
        "list_tasks",
      ]);

      const created = await client.callTool({
        name: "create_task",
        arguments: { title: "MCP protocol 검증", priority: "p2" },
      });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toMatchObject({
        task: { title: "MCP protocol 검증", status: "todo", priority: "p2" },
      });

      const tasks = await client.callTool({ name: "list_tasks", arguments: {} });
      expect(tasks.structuredContent).toMatchObject({ count: 1 });
    } finally {
      await client.close();
    }
  });
});
