import { afterEach, describe, expect, test } from "bun:test";
import { Database as BunDatabase, type SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import {
  ensureContextGraphIndex,
  loadContextGraphSnapshot,
  projectContextGraph,
  searchContextGraph,
  type ContextGraphProjectionInput,
  type GraphDatabase,
} from "./context-graph-repository";

class AsyncSqlite implements GraphDatabase {
  constructor(readonly database: BunDatabase) {}

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    return this.database.query(query).all(...bindValues as SQLQueryBindings[]) as T;
  }

  async execute(query: string, bindValues: unknown[] = []) {
    const result = this.database.query(query).run(...bindValues as SQLQueryBindings[]);
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
  }
}

const openDatabases: BunDatabase[] = [];

function migratedDatabase(): { raw: BunDatabase; adapter: AsyncSqlite } {
  const raw = new BunDatabase(":memory:");
  openDatabases.push(raw);
  raw.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("src-tauri/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(`src-tauri/migrations/${file}`, "utf8"));
  }
  return { raw, adapter: new AsyncSqlite(raw) };
}

function emptyInput(): ContextGraphProjectionInput {
  return { workItems: [], links: [], jira: [], pullRequests: [], slack: [], confluence: [], calendar: [], aiSessions: [] };
}

function seedGraphSources(database: BunDatabase): void {
  database.query(`INSERT INTO work_items(id,title,status,source,goal,position,created_at,updated_at)
    VALUES ('task-1','CGKR-42 피킹 슬립 누락 수정','todo','orbit','배치 누락 원인 확인',0,'2024-05-01T00:00:00Z','2024-05-02T00:00:00Z'),
           ('task-2','피킹 슬립 운영 확인','todo','orbit',NULL,1,'2024-05-01T00:00:00Z','2024-05-02T00:00:00Z'),
           ('task-3','유빈 인터뷰 정리','todo','orbit',NULL,2,'2024-05-01T00:00:00Z','2024-05-02T00:00:00Z')`).run();
  database.query(`INSERT INTO jira_issues(issue_key,summary,status,status_category,project_key,project_name,updated_at,url,discovered_at)
    VALUES ('CGKR-42','피킹 슬립 누락','진행 중','indeterminate','CGKR','CGKR','2024-05-02T01:00:00Z','https://example.atlassian.net/browse/CGKR-42','2024-05-02T01:00:00Z')`).run();
  database.query(`INSERT INTO github_pull_requests(repository,number,repo_path,title,url,head_ref_name,base_ref_name,updated_at,discovered_at)
    VALUES ('org/orbit',7,'/tmp/orbit','CGKR-42 누락 수정','https://github.com/org/orbit/pull/7','CGKR-42-fix','main','2024-05-03T00:00:00Z','2024-05-03T00:00:00Z')`).run();
  database.query(`INSERT INTO slack_messages(id,channel_id,channel_name,user_name,text,permalink,message_ts,discovered_at)
    VALUES ('message-1','C1','oncall','Ada','CGKR-42 피킹 슬립 누락 원인은 배치입니다.','https://example.slack.com/archives/C1/p1','1714608000.000000','2024-05-02T02:00:00Z')`).run();
  database.query(`INSERT INTO ai_sessions(provider,session_id,title,modified_at_ms,message_count,acknowledged_at_ms,linked_work_item_id,discovered_at)
    VALUES ('codex','session-1','CGKR-42 수정 세션',1714608000000,4,1714608000000,'task-1','2024-05-02T02:00:00Z')`).run();
  database.query(`INSERT INTO work_item_links(id,work_item_id,kind,external_id,external_url,label,created_at)
    VALUES ('l1','task-1','jira','CGKR-42','https://example.atlassian.net/browse/CGKR-42','CGKR-42','2024-05-02T00:00:00Z'),
           ('l2','task-1','slack','message-1','https://example.slack.com/archives/C1/p1','oncall message','2024-05-02T00:00:00Z'),
           ('l3','task-2','slack','message-1','https://example.slack.com/archives/C1/p1','same message','2024-05-02T00:00:00Z'),
           ('l4','task-1','github_commit','org/orbit@abc1234','https://github.com/org/orbit/commit/abc1234','commit abc1234','2024-05-02T00:00:00Z')`).run();
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

describe("context graph projection", () => {
  test("keeps synthetic explicit evidence and one shared source node with multiple task edges", () => {
    const input = emptyInput();
    input.workItems.push(
      { id: "t1", title: "첫 작업", status: "todo", priority: null, external_url: null, goal: null, checkpoint: null, next_action: null, done_definition: null, blocked_reason: null, resume_condition: null, created_at: "2024-01-01", updated_at: "2024-01-01", completed_at: null },
      { id: "t2", title: "둘째 작업", status: "todo", priority: null, external_url: null, goal: null, checkpoint: null, next_action: null, done_definition: null, blocked_reason: null, resume_condition: null, created_at: "2024-01-01", updated_at: "2024-01-01", completed_at: null },
    );
    input.links.push(
      { id: "l1", work_item_id: "t1", kind: "slack", external_id: "m1", external_url: "https://slack/m1", label: "메시지", created_at: "2024-01-01" },
      { id: "l2", work_item_id: "t2", kind: "slack", external_id: "m1", external_url: "https://slack/m1", label: "메시지", created_at: "2024-01-01" },
      { id: "l3", work_item_id: "t1", kind: "github_commit", external_id: "repo@abc1234", external_url: "https://github/commit/abc1234", label: "commit", created_at: "2024-01-01" },
    );

    const graph = projectContextGraph(input);
    expect(graph.nodes.filter((node) => node.sourceId === "m1")).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.relationType === "DISCUSSED_IN")).toHaveLength(2);
    expect(graph.nodes.find((node) => node.nodeType === "github_commit")?.metadata.synthetic).toBeTrue();
    expect(graph.edges.every((edge) => edge.derivation === "explicit")).toBeTrue();
  });

  test("redacts credentials and excludes injected AI session context", () => {
    const input = emptyInput();
    input.slack.push({ id: "m1", channel_id: "C1", channel_name: "ops", user_name: "Ada", text: "token=top-secret Bearer abc.def", permalink: "https://slack/m1", message_ts: "1714608000", discovered_at: "2024-01-01" });
    input.aiSessions.push({ provider: "codex", session_id: "s1", title: "세션", custom_title: null, cwd: "/tmp/orbit", model: "gpt", first_prompt: "<environment_context>private setup</environment_context>", last_prompt: "authorization=secret-value", modified_at_ms: 1714608000000, updated_at: null, linked_work_item_id: null });
    const graph = projectContextGraph(input);
    expect(graph.nodes.find((node) => node.nodeType === "slack_message")?.body).toBe("token=[REDACTED] Bearer [REDACTED]");
    const sessionBody = graph.nodes.find((node) => node.nodeType === "ai_session")?.body ?? "";
    expect(sessionBody).not.toContain("environment_context");
    expect(sessionBody).toContain("authorization=[REDACTED]");
  });
});

describe("context graph index", () => {
  test("rebuilds idempotently, prunes stale generations, and retrieves connected evidence", async () => {
    const { raw, adapter } = migratedDatabase();
    seedGraphSources(raw);
    const first = await ensureContextGraphIndex(adapter);
    const cached = await ensureContextGraphIndex(adapter);
    expect(first.rebuilt).toBeTrue();
    expect(cached).toEqual({ ...first, rebuilt: false });
    expect(raw.query("SELECT COUNT(*) count FROM context_graph_generations").get()).toEqual({ count: 1 });

    const result = await searchContextGraph("2024년 CGKR-42 관련 대화와 구현", adapter);
    expect(result.nodes.map(({ node }) => node.nodeType)).toContain("jira_issue");
    expect(result.nodes.map(({ node }) => node.nodeType)).toContain("task");
    expect(result.nodes.map(({ node }) => node.nodeType)).toContain("slack_message");
    expect(result.edges.some((edge) => edge.relationType === "TRACKED_BY" && edge.derivation === "explicit")).toBeTrue();
    expect(result.edges.some((edge) => edge.relationType === "WORKED_ON" && edge.derivation === "explicit")).toBeTrue();
    expect((await searchContextGraph("2024년에는 작업 찾아줘", adapter)).nodes.some(({ node }) => node.nodeType === "task")).toBeTrue();
    expect((await searchContextGraph("2024-05-01부터 2024-05-03까지 작업 찾아줘", adapter)).nodes.some(({ node }) => node.nodeType === "task")).toBeTrue();
    expect((await searchContextGraph("2024-05-01에서 2024-05-03까지 작업 찾아줘", adapter)).nodes.some(({ node }) => node.nodeType === "task")).toBeTrue();
    const adjacentYear = await searchContextGraph("유빈2024년 작업 찾아줘", adapter);
    expect(adjacentYear.nodes.some(({ node }) => node.label.includes("유빈"))).toBeTrue();
    expect(adjacentYear.nodes.some(({ node }) => node.sourceId === "task-1")).toBeFalse();
    expect((await searchContextGraph("%'; DROP TABLE context_graph_nodes; --", adapter)).nodes).toEqual([]);
    const snapshot = await loadContextGraphSnapshot(40, adapter);
    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.nodes.length).toBeLessThanOrEqual(40);
    expect(snapshot.edges.every((edge) => snapshot.nodes.some((node) => node.id === edge.fromNodeId)
      && snapshot.nodes.some((node) => node.id === edge.toNodeId))).toBeTrue();

    raw.query("UPDATE work_items SET title='CGKR-42 피킹 슬립 배치 수정 완료', updated_at='2024-05-04T00:00:00Z' WHERE id='task-1'").run();
    const rebuilt = await ensureContextGraphIndex(adapter);
    expect(rebuilt.generationId).not.toBe(first.generationId);
    expect(raw.query("SELECT COUNT(*) count FROM context_graph_generations").get()).toEqual({ count: 1 });
    expect(raw.query("SELECT label FROM context_graph_nodes WHERE source_id='task-1'").get()).toEqual({ label: "CGKR-42 피킹 슬립 배치 수정 완료" });
    raw.query("UPDATE ai_sessions SET custom_title='동일 길이 새 이름' WHERE provider='codex' AND session_id='session-1'").run();
    const titleRebuild = await ensureContextGraphIndex(adapter);
    expect(titleRebuild.generationId).not.toBe(rebuilt.generationId);
    expect(raw.query("SELECT label FROM context_graph_nodes WHERE generation_id=? AND node_type='ai_session'").get(titleRebuild.generationId)).toEqual({ label: "동일 길이 새 이름" });
    expect(raw.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("uses single-flight for concurrent rebuild requests", async () => {
    const { raw, adapter } = migratedDatabase();
    seedGraphSources(raw);
    const [left, right] = await Promise.all([
      ensureContextGraphIndex(adapter),
      ensureContextGraphIndex(adapter),
    ]);
    expect(left.generationId).toBe(right.generationId);
    expect(raw.query("SELECT COUNT(*) count FROM context_graph_generations WHERE status='ready'").get()).toEqual({ count: 1 });
  });

  test("does not publish a mixed snapshot when canonical data changes at publish time", async () => {
    const { raw, adapter } = migratedDatabase();
    seedGraphSources(raw);
    let mutated = false;
    const racingAdapter: GraphDatabase = {
      select: adapter.select.bind(adapter),
      execute: async (query, values) => {
        if (!mutated && query.includes("SET status='ready'")) {
          mutated = true;
          raw.query("UPDATE work_items SET title='경쟁 중 변경됨', updated_at='2024-05-05T00:00:00Z' WHERE id='task-1'").run();
        }
        return adapter.execute(query, values);
      },
    };
    const state = await ensureContextGraphIndex(racingAdapter);
    expect(mutated).toBeTrue();
    expect(raw.query("SELECT label FROM context_graph_nodes WHERE generation_id=? AND source_id='task-1'").get(state.generationId)).toEqual({ label: "경쟁 중 변경됨" });
    expect(raw.query("SELECT COUNT(*) count FROM context_graph_generations WHERE status='ready'").get()).toEqual({ count: 1 });
  });

  test("keeps the previous ready generation visible when a staged rebuild fails", async () => {
    const { raw, adapter } = migratedDatabase();
    seedGraphSources(raw);
    const first = await ensureContextGraphIndex(adapter);
    raw.query("UPDATE work_items SET title='실패 중 변경', updated_at='2024-05-06T00:00:00Z' WHERE id='task-1'").run();
    let failed = false;
    const failingAdapter: GraphDatabase = {
      select: adapter.select.bind(adapter),
      execute: async (query, values) => {
        if (!failed && query.startsWith("INSERT INTO context_graph_nodes")) {
          failed = true;
          throw new Error("injected graph write failure");
        }
        return adapter.execute(query, values);
      },
    };
    await expect(ensureContextGraphIndex(failingAdapter)).rejects.toThrow("injected graph write failure");
    expect(raw.query("SELECT current_generation_id FROM context_graph_index_state WHERE id=1").get()).toEqual({ current_generation_id: first.generationId });
    expect(raw.query("SELECT COUNT(*) count FROM context_graph_generations WHERE status='failed'").get()).toEqual({ count: 1 });
    const oldResult = await searchContextGraph("CGKR-42", adapter);
    expect(oldResult.generationId).toBe(first.generationId);
    await ensureContextGraphIndex(adapter);
    expect(raw.query("SELECT COUNT(*) count FROM context_graph_generations WHERE status='failed'").get()).toEqual({ count: 0 });
  });

  test("retries search when its pinned generation is published over and pruned", async () => {
    const { raw, adapter } = migratedDatabase();
    seedGraphSources(raw);
    const first = await ensureContextGraphIndex(adapter);
    raw.query(`INSERT INTO context_graph_generations(id,schema_version,source_fingerprint,started_at)
      VALUES ('race-g2',1,'race-fingerprint','2024-05-07T00:00:00Z')`).run();
    raw.query(`INSERT INTO context_graph_nodes(
      generation_id,id,node_type,source_type,source_id,label,body,search_text,occurred_at,updated_at,metadata_json
    ) VALUES ('race-g2','task:race','task','task','race','교체 후 검색 노드','','교체 후 검색 노드','2024-05-07','2024-05-07','{}')`).run();
    let published = false;
    const racingAdapter: GraphDatabase = {
      execute: adapter.execute.bind(adapter),
      select: async (query, values) => {
        if (!published && query.includes("FROM context_graph_nodes") && values?.[0] === first.generationId) {
          published = true;
          raw.query(`UPDATE context_graph_generations SET status='ready',completed_at='2024-05-07T00:00:01Z',node_count=1,edge_count=0 WHERE id='race-g2'`).run();
          raw.query("DELETE FROM context_graph_generations WHERE id=?").run(first.generationId);
        }
        return adapter.select(query, values);
      },
    };
    const result = await searchContextGraph("교체 후 검색", racingAdapter);
    expect(published).toBeTrue();
    expect(result.generationId).toBe("race-g2");
    expect(result.nodes.map(({ node }) => node.label)).toContain("교체 후 검색 노드");
  });

  test("bounds representative rebuild and targeted search work", async () => {
    const { raw, adapter } = migratedDatabase();
    raw.exec("BEGIN");
    const insertTask = raw.prepare(`INSERT INTO work_items(id,title,status,source,position,created_at,updated_at)
      VALUES (?,?, 'todo','orbit',0,'2024-01-01','2024-01-01')`);
    const insertSlack = raw.prepare(`INSERT INTO slack_messages(id,channel_id,channel_name,user_name,text,permalink,message_ts,discovered_at)
      VALUES (?,'C1','perf','Ada',?,?,?,'2024-01-01')`);
    for (let index = 0; index < 500; index += 1) insertTask.run(`t${index}`, `성능 작업 ${index}`);
    for (let index = 0; index < 5_000; index += 1) insertSlack.run(`m${index}`, `성능 메시지 ${index}`, `https://slack/${index}`, `${1704067200 + index}`);
    raw.exec("COMMIT");
    const startedAt = performance.now();
    await ensureContextGraphIndex(adapter);
    const result = await searchContextGraph("성능 메시지 4999", adapter);
    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThan(2_000);
    expect(result.nodes.length).toBeLessThanOrEqual(30);
    expect(result.nodes.some(({ node }) => node.sourceId === "m4999")).toBeTrue();
  });
});
