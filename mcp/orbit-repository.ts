import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type TaskStatus = "inbox" | "todo" | "focus" | "ai_running" | "review" | "blocked" | "done";
export type TaskPriority = "p1" | "p2" | "p3";

export interface CreateTaskInput {
  title: string;
  goal?: string;
  nextAction?: string;
  doneDefinition?: string;
  priority?: TaskPriority;
  targetAt?: string;
  status?: "inbox" | "todo";
}

export interface OrbitTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  goal: string | null;
  nextAction: string | null;
  targetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrbitTicket {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  priority: string | null;
  projectKey: string;
  dueDate: string | null;
  updatedAt: string;
  url: string;
  linkedTasks: Array<{ id: string; title: string; status: TaskStatus }>;
}

export interface OrbitRepositoryOptions {
  databasePath?: string;
  readOnly?: boolean;
}

const requiredTables = ["work_items", "jira_issues", "work_item_links"] as const;

export function resolveOrbitDatabasePath(environment = process.env): string {
  const override = environment.ORBIT_DB_PATH?.trim();
  if (override) return override;

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "com.orbit.desktop", "orbit.db");
  }
  if (platform() === "win32") {
    const appData = environment.APPDATA?.trim();
    if (!appData) throw new Error("APPDATA를 찾을 수 없습니다. ORBIT_DB_PATH를 지정해주세요.");
    return join(appData, "com.orbit.desktop", "orbit.db");
  }

  const dataHome = environment.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "com.orbit.desktop", "orbit.db");
}

export class OrbitRepository {
  readonly databasePath: string;
  readonly readOnly: boolean;
  private readonly database: Database;

  constructor(options: OrbitRepositoryOptions = {}) {
    this.databasePath = options.databasePath || resolveOrbitDatabasePath();
    this.readOnly = options.readOnly ?? process.env.ORBIT_MCP_READ_ONLY === "1";

    if (!existsSync(this.databasePath)) {
      throw new Error(`Orbit 데이터베이스를 찾을 수 없습니다: ${this.databasePath}`);
    }

    // Tauri's SQLite file can require a writable handle for journal/locking even for reads.
    // `query_only` enforces the MCP read-only policy at the connection level without
    // preventing SQLite from participating in that locking protocol.
    this.database = new Database(this.databasePath, { readwrite: true, create: false, strict: true });
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (this.readOnly) this.database.exec("PRAGMA query_only = ON;");
    this.assertCompatibleSchema();
  }

  close(): void {
    this.database.close();
  }

  createTask(input: CreateTaskInput): OrbitTask {
    if (this.readOnly) throw new Error("ORBIT_MCP_READ_ONLY=1에서는 할 일을 생성할 수 없습니다.");

    const title = input.title.trim();
    if (!title) throw new Error("할 일 제목은 비워둘 수 없습니다.");

    const status = input.status ?? "todo";
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const targetAt = normalizeOptionalDate(input.targetAt);
    const insert = this.database.transaction(() => {
      const positionRow = this.database
        .query<{ nextPosition: number }, [string]>(
          "SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM work_items WHERE status = ?",
        )
        .get(status);
      const position = positionRow?.nextPosition ?? 0;

      this.database
        .query<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, number, string, string]>(
          `INSERT INTO work_items (
             id, title, status, priority, source, goal, next_action, done_definition,
             target_at, position, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'orbit', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          title,
          status,
          input.priority ?? null,
          cleanOptionalText(input.goal),
          cleanOptionalText(input.nextAction),
          cleanOptionalText(input.doneDefinition),
          targetAt,
          position,
          now,
          now,
        );
    });
    insert();

    const created = this.getTask(id);
    if (!created) throw new Error("할 일을 생성했지만 다시 읽지 못했습니다.");
    return created;
  }

  getTask(id: string): OrbitTask | null {
    const row = this.database.query<TaskRow, [string]>(taskSelect("WHERE id = ?")).get(id);
    return row ? toTask(row) : null;
  }

  listTasks(options: { status?: TaskStatus | "open" | "all"; query?: string; limit?: number } = {}): OrbitTask[] {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    const status = options.status ?? "open";
    if (status === "open") conditions.push("status <> 'done'");
    else if (status !== "all") {
      conditions.push("status = ?");
      values.push(status);
    }
    const search = options.query?.trim();
    if (search) {
      conditions.push("(title LIKE ? ESCAPE '\\' OR COALESCE(goal, '') LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(search)}%`;
      values.push(pattern, pattern);
    }
    const limit = clampLimit(options.limit);
    values.push(limit);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.database
      .query<TaskRow, Array<string | number>>(
        `${taskSelect(where)} ORDER BY updated_at DESC, created_at DESC LIMIT ?`,
      )
      .all(...values);
    return rows.map(toTask);
  }

  listMyTickets(options: { state?: "open" | "done" | "all"; query?: string; limit?: number } = {}): OrbitTicket[] {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    const state = options.state ?? "open";
    if (state === "open") conditions.push("lower(j.status_category) <> 'done'");
    else if (state === "done") conditions.push("lower(j.status_category) = 'done'");
    const search = options.query?.trim();
    if (search) {
      conditions.push("(j.issue_key LIKE ? ESCAPE '\\' OR j.summary LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(search)}%`;
      values.push(pattern, pattern);
    }
    const limit = clampLimit(options.limit);
    values.push(limit);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const tickets = this.database
      .query<TicketRow, Array<string | number>>(
        `SELECT j.issue_key, j.summary, j.status, j.status_category, j.priority,
                j.project_key, j.due_date, j.updated_at, j.url
         FROM jira_issues j
         ${where}
         ORDER BY j.updated_at DESC
         LIMIT ?`,
      )
      .all(...values);

    if (tickets.length === 0) return [];
    const keys = tickets.map((ticket) => ticket.issue_key);
    const placeholders = keys.map(() => "?").join(", ");
    const links = this.database
      .query<LinkedTaskRow, string[]>(
        `SELECT l.external_id AS issue_key, w.id, w.title, w.status
         FROM work_item_links l
         JOIN work_items w ON w.id = l.work_item_id
         WHERE l.kind = 'jira' AND l.external_id IN (${placeholders})
         ORDER BY w.updated_at DESC`,
      )
      .all(...keys);
    const linksByKey = new Map<string, OrbitTicket["linkedTasks"]>();
    for (const link of links) {
      const linkedTasks = linksByKey.get(link.issue_key) ?? [];
      linkedTasks.push({ id: link.id, title: link.title, status: link.status });
      linksByKey.set(link.issue_key, linkedTasks);
    }

    return tickets.map((ticket) => ({
      key: ticket.issue_key,
      summary: ticket.summary,
      status: ticket.status,
      statusCategory: ticket.status_category,
      priority: ticket.priority,
      projectKey: ticket.project_key,
      dueDate: ticket.due_date,
      updatedAt: ticket.updated_at,
      url: ticket.url,
      linkedTasks: linksByKey.get(ticket.issue_key) ?? [],
    }));
  }

  private assertCompatibleSchema(): void {
    const placeholders = requiredTables.map(() => "?").join(", ");
    const rows = this.database
      .query<{ name: string }, string[]>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      )
      .all(...requiredTables);
    const found = new Set(rows.map((row) => row.name));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length > 0) {
      throw new Error(`Orbit 데이터베이스 스키마가 준비되지 않았습니다: ${missing.join(", ")}`);
    }
  }
}

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  goal: string | null;
  next_action: string | null;
  target_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TicketRow {
  issue_key: string;
  summary: string;
  status: string;
  status_category: string;
  priority: string | null;
  project_key: string;
  due_date: string | null;
  updated_at: string;
  url: string;
}

interface LinkedTaskRow {
  issue_key: string;
  id: string;
  title: string;
  status: TaskStatus;
}

function taskSelect(where: string): string {
  return `SELECT id, title, status, priority, goal, next_action, target_at, created_at, updated_at
          FROM work_items ${where}`;
}

function toTask(row: TaskRow): OrbitTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    goal: row.goal,
    nextAction: row.next_action,
    targetAt: row.target_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanOptionalText(value?: string): string | null {
  return value?.trim() || null;
}

function normalizeOptionalDate(value?: string): string | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("targetAt은 유효한 ISO 8601 날짜여야 합니다.");
  return date.toISOString();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return 30;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}
