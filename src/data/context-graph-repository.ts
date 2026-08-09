import type Database from "@tauri-apps/plugin-sql";
import { isInternalSessionText } from "../domain/ai-session";
import {
  boundedGraphTraversal,
  canonicalGraphText,
  extractGraphDateRange,
  findJiraKeys,
  formatGraphContext,
  graphEdgeId,
  graphNodeId,
  graphQueryTokens,
  graphTokens,
  inferTaskSourceEdge,
  rankGraphCandidates,
  type ContextGraphEdge,
  type ContextGraphNode,
  type ContextGraphSearchResult,
} from "../domain/context-graph";
import { getDatabase } from "./database";

const GRAPH_SCHEMA_VERSION = 1;
const MAX_REBUILD_ATTEMPTS = 2;
const SOURCE_FINGERPRINT_VALUE_SQL = `
  SELECT printf(
    'revision:%d|work_items:%d:%s|work_item_links:%d:%s|jira_issues:%d:%s|github_pull_requests:%d:%s|slack_messages:%d:%s|confluence_pages:%d:%s|calendar_events:%d:%s|ai_sessions:%d:%s',
    (SELECT revision FROM context_graph_source_state WHERE id=1),
    (SELECT COUNT(*) FROM work_items), (SELECT COALESCE(MAX(updated_at), '') FROM work_items),
    (SELECT COUNT(*) FROM work_item_links), (SELECT COALESCE(MAX(COALESCE(last_synced_at, created_at)), '') FROM work_item_links),
    (SELECT COUNT(*) FROM jira_issues), (SELECT COALESCE(MAX(updated_at), '') FROM jira_issues),
    (SELECT COUNT(*) FROM github_pull_requests), (SELECT COALESCE(MAX(updated_at), '') FROM github_pull_requests),
    (SELECT COUNT(*) FROM slack_messages), (SELECT COALESCE(MAX(discovered_at), '') FROM slack_messages),
    (SELECT COUNT(*) FROM confluence_pages), (SELECT COALESCE(MAX(discovered_at), '') FROM confluence_pages),
    (SELECT COUNT(*) FROM calendar_events), (SELECT COALESCE(MAX(updated_at), '') FROM calendar_events),
    (SELECT COUNT(*) FROM ai_sessions), (SELECT COALESCE(CAST(MAX(modified_at_ms) AS TEXT), '') FROM ai_sessions)
  )
`;

export type GraphDatabase = Pick<Database, "select" | "execute">;

interface WorkItemRow {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  external_url: string | null;
  goal: string | null;
  checkpoint: string | null;
  next_action: string | null;
  done_definition: string | null;
  blocked_reason: string | null;
  resume_condition: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface WorkItemLinkRow {
  id: string;
  work_item_id: string;
  kind: "jira" | "github_pr" | "github_commit" | "slack";
  external_id: string | null;
  external_url: string | null;
  label: string;
  created_at: string;
}

interface JiraRow { issue_key: string; summary: string; status: string; priority: string | null; project_key: string; due_date: string | null; updated_at: string; url: string }
interface PullRequestRow { repository: string; number: number; title: string; url: string; head_ref_name: string; base_ref_name: string; author_login: string | null; updated_at: string }
interface SlackRow { id: string; channel_id: string; channel_name: string; user_name: string; text: string; permalink: string; message_ts: string; discovered_at: string }
interface ConfluenceRow { id: string; title: string; space_key: string; excerpt: string; url: string; last_modified: string; discovered_at: string }
interface CalendarRow { id: string; title: string; start_at: string; end_at: string; source: string; external_url: string | null; location: string | null; notes: string | null; updated_at: string }
interface AiSessionRow { provider: string; session_id: string; title: string; custom_title: string | null; cwd: string | null; model: string | null; first_prompt: string | null; last_prompt: string | null; modified_at_ms: number; updated_at: string | null; linked_work_item_id: string | null }

export interface ContextGraphProjectionInput {
  workItems: WorkItemRow[];
  links: WorkItemLinkRow[];
  jira: JiraRow[];
  pullRequests: PullRequestRow[];
  slack: SlackRow[];
  confluence: ConfluenceRow[];
  calendar: CalendarRow[];
  aiSessions: AiSessionRow[];
}

export interface ContextGraphProjection {
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
}

export interface ContextGraphIndexState {
  generationId: string;
  sourceFingerprint: string;
  nodeCount: number;
  edgeCount: number;
  rebuilt: boolean;
}

export interface ContextGraphSnapshot extends ContextGraphIndexState {
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
}

interface IndexStateRow {
  current_generation_id: string;
  source_fingerprint: string;
  node_count: number;
  edge_count: number;
}

interface GraphNodeRow {
  id: string;
  node_type: ContextGraphNode["nodeType"];
  source_type: string;
  source_id: string;
  label: string;
  body: string;
  url: string | null;
  occurred_at: string | null;
  updated_at: string | null;
  metadata_json: string;
}

interface GraphEdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: string;
  derivation_kind: ContextGraphEdge["derivation"];
  weight: number;
  evidence_json: string;
}

function compactBody(values: Array<string | null | undefined>): string {
  return safeGraphBody(values.filter(Boolean).join(" · "));
}

function safeGraphBody(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|authorization|cookie|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4_000);
}

function slackTimestamp(value: string): string | null {
  const seconds = Number.parseFloat(value);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoFromMilliseconds(value: number): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseGraphJson(value: string, field: "metadata" | "evidence"): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch (cause) {
    throw new Error(`Invalid context graph ${field} JSON`, { cause });
  }
  throw new Error(`Invalid context graph ${field} JSON object`);
}

function normalizeJiraId(value: string): string | null {
  return value.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i)?.[1]?.toUpperCase() ?? null;
}

function normalizePullRequestId(value: string, url: string | null): string | null {
  const direct = value.match(/^([^/\s]+\/[^#\s]+)#(\d+)$/);
  if (direct) return `${direct[1]}#${direct[2]}`;
  const fromUrl = url?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
  return fromUrl ? `${fromUrl[1]}#${fromUrl[2]}` : null;
}

function relationForLink(kind: WorkItemLinkRow["kind"]): string {
  if (kind === "jira") return "TRACKED_BY";
  if (kind === "github_pr") return "IMPLEMENTED_BY";
  if (kind === "github_commit") return "EVIDENCED_BY";
  return "DISCUSSED_IN";
}

function linkedNodeIdentity(link: WorkItemLinkRow): { nodeType: ContextGraphNode["nodeType"]; sourceType: string; sourceId: string } | null {
  const raw = link.external_id ?? link.label;
  if (link.kind === "jira") {
    const sourceId = normalizeJiraId(raw) ?? normalizeJiraId(link.external_url ?? "");
    return sourceId ? { nodeType: "jira_issue", sourceType: "jira", sourceId } : null;
  }
  if (link.kind === "github_pr") {
    const sourceId = normalizePullRequestId(raw, link.external_url);
    return sourceId ? { nodeType: "pull_request", sourceType: "github_pr", sourceId } : null;
  }
  if (link.kind === "github_commit") {
    return raw.trim() ? { nodeType: "github_commit", sourceType: "github_commit", sourceId: raw.trim() } : null;
  }
  return raw.trim() ? { nodeType: "slack_message", sourceType: "slack", sourceId: raw.trim() } : null;
}

export function projectContextGraph(input: ContextGraphProjectionInput): ContextGraphProjection {
  const nodes = new Map<string, ContextGraphNode>();
  const edges = new Map<string, ContextGraphEdge>();
  const edgeIdsByIdentity = new Map<string, string>();
  const addNode = (node: ContextGraphNode) => nodes.set(node.id, node);
  const addEdge = (edge: ContextGraphEdge) => {
    const identity = `${edge.fromNodeId}|${edge.toNodeId}|${edge.relationType}`;
    const currentId = edgeIdsByIdentity.get(identity);
    const current = currentId ? edges.get(currentId) : undefined;
    if (!current || (current.derivation !== "explicit" && edge.derivation === "explicit") || current.weight < edge.weight) {
      if (current) edges.delete(current.id);
      edges.set(edge.id, edge);
      edgeIdsByIdentity.set(identity, edge.id);
    }
  };

  for (const task of input.workItems) addNode({
    id: graphNodeId("task", task.id), nodeType: "task", sourceType: "task", sourceId: task.id,
    label: task.title,
    body: compactBody([`status=${task.status}`, task.priority && `priority=${task.priority}`, task.goal, task.checkpoint, task.next_action, task.done_definition, task.blocked_reason, task.resume_condition]),
    url: task.external_url, occurredAt: task.completed_at ?? task.created_at, updatedAt: task.updated_at,
    metadata: { status: task.status, priority: task.priority },
  });
  for (const issue of input.jira) addNode({
    id: graphNodeId("jira", issue.issue_key), nodeType: "jira_issue", sourceType: "jira", sourceId: issue.issue_key.toUpperCase(),
    label: `${issue.issue_key.toUpperCase()} · ${issue.summary}`, body: compactBody([`status=${issue.status}`, issue.priority && `priority=${issue.priority}`, `project=${issue.project_key}`, issue.due_date && `due=${issue.due_date}`]),
    url: issue.url, occurredAt: issue.updated_at, updatedAt: issue.updated_at, metadata: { status: issue.status, projectKey: issue.project_key },
  });
  for (const pullRequest of input.pullRequests) {
    const sourceId = `${pullRequest.repository}#${pullRequest.number}`;
    addNode({
      id: graphNodeId("github_pr", sourceId), nodeType: "pull_request", sourceType: "github_pr", sourceId,
      label: `${sourceId} · ${pullRequest.title}`, body: compactBody([`branch=${pullRequest.head_ref_name}→${pullRequest.base_ref_name}`, pullRequest.author_login && `author=${pullRequest.author_login}`]),
      url: pullRequest.url, occurredAt: pullRequest.updated_at, updatedAt: pullRequest.updated_at, metadata: { repository: pullRequest.repository, number: pullRequest.number },
    });
  }
  for (const message of input.slack) addNode({
    id: graphNodeId("slack", message.id), nodeType: "slack_message", sourceType: "slack", sourceId: message.id,
    label: `#${message.channel_name || message.channel_id} · ${message.user_name || "unknown"}`, body: safeGraphBody(message.text),
    url: message.permalink, occurredAt: slackTimestamp(message.message_ts), updatedAt: message.discovered_at,
    metadata: { channelId: message.channel_id, channelName: message.channel_name, author: message.user_name },
  });
  for (const page of input.confluence) addNode({
    id: graphNodeId("confluence", page.id), nodeType: "confluence_page", sourceType: "confluence", sourceId: page.id,
    label: page.title, body: safeGraphBody(page.excerpt), url: page.url, occurredAt: page.last_modified, updatedAt: page.discovered_at,
    metadata: { spaceKey: page.space_key },
  });
  for (const event of input.calendar) addNode({
    id: graphNodeId("calendar", event.id), nodeType: "calendar_event", sourceType: "calendar", sourceId: event.id,
    label: event.title, body: compactBody([event.location, event.notes, `end=${event.end_at}`]), url: event.external_url,
    occurredAt: event.start_at, updatedAt: event.updated_at, metadata: { source: event.source, endAt: event.end_at },
  });
  for (const session of input.aiSessions) addNode({
    id: graphNodeId("ai_session", `${session.provider}:${session.session_id}`), nodeType: "ai_session", sourceType: "ai_session", sourceId: `${session.provider}:${session.session_id}`,
    label: session.custom_title || session.title,
    body: compactBody([session.cwd, session.model, isInternalSessionText(session.first_prompt) ? null : session.first_prompt, isInternalSessionText(session.last_prompt) ? null : session.last_prompt]),
    url: null,
    occurredAt: isoFromMilliseconds(session.modified_at_ms), updatedAt: session.updated_at ?? isoFromMilliseconds(session.modified_at_ms),
    metadata: { provider: session.provider, cwd: session.cwd },
  });

  for (const link of input.links) {
    const taskNodeId = graphNodeId("task", link.work_item_id);
    if (!nodes.has(taskNodeId)) continue;
    const identity = linkedNodeIdentity(link);
    if (!identity) continue;
    const targetNodeId = graphNodeId(identity.sourceType, identity.sourceId);
    if (!nodes.has(targetNodeId)) addNode({
      id: targetNodeId, nodeType: identity.nodeType, sourceType: identity.sourceType, sourceId: identity.sourceId,
      label: link.label || identity.sourceId, body: "캐시에 원문이 없는 명시적 연결", url: link.external_url,
      occurredAt: link.created_at, updatedAt: link.created_at, metadata: { synthetic: true, linkId: link.id },
    });
    const relationType = relationForLink(link.kind);
    addEdge({
      id: graphEdgeId(taskNodeId, relationType, targetNodeId), fromNodeId: taskNodeId, toNodeId: targetNodeId,
      relationType, derivation: "explicit", weight: 1,
      evidence: { rule: "work_item_link", linkId: link.id, kind: link.kind, label: link.label, url: link.external_url },
    });
  }

  for (const session of input.aiSessions) {
    if (!session.linked_work_item_id) continue;
    const sessionNodeId = graphNodeId("ai_session", `${session.provider}:${session.session_id}`);
    const taskNodeId = graphNodeId("task", session.linked_work_item_id);
    if (!nodes.has(sessionNodeId) || !nodes.has(taskNodeId)) continue;
    addEdge({
      id: graphEdgeId(sessionNodeId, "WORKED_ON", taskNodeId), fromNodeId: sessionNodeId, toNodeId: taskNodeId,
      relationType: "WORKED_ON", derivation: "explicit", weight: 1,
      evidence: { rule: "ai_session_link", provider: session.provider, sessionId: session.session_id },
    });
  }

  const taskNodes = [...nodes.values()].filter((node) => node.nodeType === "task");
  const sourceNodes = [...nodes.values()].filter((node) => node.nodeType !== "task");
  const explicitlyLinked = new Set([...edges.values()].map((edge) => `${edge.fromNodeId}|${edge.toNodeId}`));
  const taskById = new Map(taskNodes.map((task) => [task.id, task]));
  const taskIdsByToken = new Map<string, Set<string>>();
  const taskIdsByJiraKey = new Map<string, Set<string>>();
  for (const task of taskNodes) {
    for (const token of graphTokens(task.label)) {
      const ids = taskIdsByToken.get(token) ?? new Set<string>();
      ids.add(task.id);
      taskIdsByToken.set(token, ids);
    }
    for (const key of findJiraKeys(`${task.label} ${task.body}`)) {
      const ids = taskIdsByJiraKey.get(key) ?? new Set<string>();
      ids.add(task.id);
      taskIdsByJiraKey.set(key, ids);
    }
  }
  for (const source of sourceNodes) {
    const candidateIds = new Set<string>();
    for (const token of graphTokens(source.label)) {
      for (const taskId of taskIdsByToken.get(token) ?? []) candidateIds.add(taskId);
    }
    for (const key of findJiraKeys(`${source.sourceId} ${source.label} ${source.body}`)) {
      for (const taskId of taskIdsByJiraKey.get(key) ?? []) candidateIds.add(taskId);
    }
    for (const taskId of candidateIds) {
      const task = taskById.get(taskId);
      if (!task) continue;
      if (explicitlyLinked.has(`${task.id}|${source.id}`) || explicitlyLinked.has(`${source.id}|${task.id}`)) continue;
      const inferred = inferTaskSourceEdge(task, source);
      if (inferred) addEdge(inferred);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

async function sourceFingerprint(database: GraphDatabase): Promise<string> {
  const row = (await database.select<Array<{ fingerprint: string }>>(`SELECT (${SOURCE_FINGERPRINT_VALUE_SQL}) fingerprint`))[0];
  return row?.fingerprint ?? "";
}

async function loadProjectionInput(database: GraphDatabase): Promise<ContextGraphProjectionInput> {
  const [workItems, links, jira, pullRequests, slack, confluence, calendar, aiSessions] = await Promise.all([
    database.select<WorkItemRow[]>(`SELECT id, title, status, priority, external_url, goal, checkpoint, next_action, done_definition, blocked_reason, resume_condition, created_at, updated_at, completed_at FROM work_items`),
    database.select<WorkItemLinkRow[]>(`SELECT id, work_item_id, kind, external_id, external_url, label, created_at FROM work_item_links`),
    database.select<JiraRow[]>(`SELECT issue_key, summary, status, priority, project_key, due_date, updated_at, url FROM jira_issues`),
    database.select<PullRequestRow[]>(`SELECT repository, number, title, url, head_ref_name, base_ref_name, author_login, updated_at FROM github_pull_requests`),
    database.select<SlackRow[]>(`SELECT id, channel_id, channel_name, user_name, text, permalink, message_ts, discovered_at FROM slack_messages`),
    database.select<ConfluenceRow[]>(`SELECT id, title, space_key, excerpt, url, last_modified, discovered_at FROM confluence_pages`),
    database.select<CalendarRow[]>(`SELECT id, title, start_at, end_at, source, external_url, location, notes, updated_at FROM calendar_events`),
    database.select<AiSessionRow[]>(`SELECT provider, session_id, title, custom_title, cwd, model, first_prompt, last_prompt, modified_at_ms, updated_at, linked_work_item_id FROM ai_sessions`),
  ]);
  return { workItems, links, jira, pullRequests, slack, confluence, calendar, aiSessions };
}

async function markGenerationFailed(database: GraphDatabase, generationId: string, cause: unknown): Promise<void> {
  const detail = (cause instanceof Error ? cause.message : String(cause)).replace(/\s+/g, " ").slice(0, 500) || "unknown rebuild error";
  await database.execute(
    `UPDATE context_graph_generations SET status='failed', completed_at=$1, error_summary=$2 WHERE id=$3 AND status='building'`,
    [new Date().toISOString(), detail, generationId],
  ).catch(() => undefined);
}

async function insertBatches(
  database: GraphDatabase,
  table: "context_graph_nodes" | "context_graph_edges",
  columns: string[],
  rows: unknown[][],
  batchSize: number,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flat();
    const placeholders = batch.map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(",")})`).join(",");
    await database.execute(`INSERT INTO ${table}(${columns.join(",")}) VALUES ${placeholders}`, values);
  }
}

async function rebuildOnce(database: GraphDatabase): Promise<ContextGraphIndexState> {
  const initialFingerprint = await sourceFingerprint(database);
  const input = await loadProjectionInput(database);
  if (await sourceFingerprint(database) !== initialFingerprint) throw new Error("context_graph_sources_changed_during_projection");
  const projection = projectContextGraph(input);
  const generationId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await database.execute(
    `INSERT INTO context_graph_generations(id, schema_version, source_fingerprint, status, started_at) VALUES($1,$2,$3,'building',$4)`,
    [generationId, GRAPH_SCHEMA_VERSION, initialFingerprint, startedAt],
  );
  try {
    await insertBatches(
      database,
      "context_graph_nodes",
      ["generation_id", "id", "node_type", "source_type", "source_id", "label", "body", "search_text", "url", "occurred_at", "updated_at", "metadata_json"],
      projection.nodes.map((node) => [
        generationId, node.id, node.nodeType, node.sourceType, node.sourceId, node.label, node.body,
        canonicalGraphText(`${node.sourceId} ${node.label} ${node.body}`),
        node.url, node.occurredAt, node.updatedAt, JSON.stringify(node.metadata),
      ]),
      60,
    );
    await insertBatches(
      database,
      "context_graph_edges",
      ["generation_id", "id", "from_node_id", "to_node_id", "relation_type", "derivation_kind", "weight", "evidence_json", "created_at"],
      projection.edges.map((edge) => [
        generationId, edge.id, edge.fromNodeId, edge.toNodeId, edge.relationType, edge.derivation,
        edge.weight, JSON.stringify(edge.evidence), startedAt,
      ]),
      80,
    );
    if (await sourceFingerprint(database) !== initialFingerprint) throw new Error("context_graph_sources_changed_before_publish");
    await database.execute(
      `UPDATE context_graph_generations
       SET status='ready', completed_at=$1, node_count=$2, edge_count=$3
       WHERE id=$4 AND status='building' AND source_fingerprint=(${SOURCE_FINGERPRINT_VALUE_SQL})`,
      [new Date().toISOString(), projection.nodes.length, projection.edges.length, generationId],
    );
    const published = (await database.select<Array<{ generation_id: string }>>(
      `SELECT current_generation_id generation_id FROM context_graph_index_state WHERE id=1 AND current_generation_id=$1`,
      [generationId],
    ))[0];
    if (!published) throw new Error("context_graph_sources_changed_before_publish");
    await database.execute(`DELETE FROM context_graph_generations WHERE id <> $1 AND status IN ('ready','failed')`, [generationId]);
    return { generationId, sourceFingerprint: initialFingerprint, nodeCount: projection.nodes.length, edgeCount: projection.edges.length, rebuilt: true };
  } catch (cause) {
    await markGenerationFailed(database, generationId, cause);
    throw cause;
  }
}

let activeRebuild: Promise<ContextGraphIndexState> | null = null;

export async function ensureContextGraphIndex(database?: GraphDatabase): Promise<ContextGraphIndexState> {
  const connection = database ?? await getDatabase();
  const fingerprint = await sourceFingerprint(connection);
  const state = (await connection.select<IndexStateRow[]>(`
    SELECT s.current_generation_id, s.source_fingerprint, s.node_count, s.edge_count
    FROM context_graph_index_state s
    JOIN context_graph_generations g ON g.id=s.current_generation_id AND g.status='ready'
    WHERE s.id=1 AND s.schema_version=$1
  `, [GRAPH_SCHEMA_VERSION]))[0];
  if (state?.source_fingerprint === fingerprint) return {
    generationId: state.current_generation_id, sourceFingerprint: state.source_fingerprint,
    nodeCount: Number(state.node_count), edgeCount: Number(state.edge_count), rebuilt: false,
  };
  if (activeRebuild) return activeRebuild;
  activeRebuild = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_REBUILD_ATTEMPTS; attempt += 1) {
      try { return await rebuildOnce(connection); }
      catch (cause) {
        lastError = cause;
        if (!(cause instanceof Error) || !cause.message.includes("sources_changed")) break;
      }
    }
    throw lastError;
  })();
  try { return await activeRebuild; }
  finally { activeRebuild = null; }
}

function toGraphNode(row: GraphNodeRow): ContextGraphNode {
  return {
    id: row.id, nodeType: row.node_type, sourceType: row.source_type, sourceId: row.source_id,
    label: row.label, body: row.body, url: row.url, occurredAt: row.occurred_at, updatedAt: row.updated_at,
    metadata: parseGraphJson(row.metadata_json, "metadata"),
  };
}

function toGraphEdge(row: GraphEdgeRow): ContextGraphEdge {
  return {
    id: row.id, fromNodeId: row.from_node_id, toNodeId: row.to_node_id, relationType: row.relation_type,
    derivation: row.derivation_kind, weight: Number(row.weight), evidence: parseGraphJson(row.evidence_json, "evidence"),
  };
}

async function currentReadyGeneration(database: GraphDatabase): Promise<string | null> {
  const row = (await database.select<Array<{ generation_id: string }>>(`
    SELECT g.id generation_id FROM context_graph_index_state s
    JOIN context_graph_generations g ON g.id=s.current_generation_id AND g.status='ready'
    WHERE s.id=1 AND s.schema_version=$1
  `, [GRAPH_SCHEMA_VERSION]))[0];
  return row?.generation_id ?? null;
}

async function loadSeedNodes(database: GraphDatabase, generationId: string, question: string): Promise<ContextGraphNode[]> {
  const tokens = graphQueryTokens(question);
  const jiraKeys = findJiraKeys(question);
  const dateRange = extractGraphDateRange(question);
  if (tokens.length === 0 && jiraKeys.length === 0 && !dateRange) return [];
  const values: unknown[] = [generationId];
  const textConditions: string[] = [];
  const scoreExpressions: string[] = [];
  for (const token of tokens) {
    values.push(canonicalGraphText(token));
    textConditions.push(`instr(search_text, $${values.length}) > 0`);
    scoreExpressions.push(`CASE WHEN instr(search_text, $${values.length}) > 0 THEN 1 ELSE 0 END`);
  }
  for (const key of jiraKeys) {
    values.push(key);
    textConditions.push(`upper(source_id) = $${values.length}`);
    scoreExpressions.push(`CASE WHEN upper(source_id) = $${values.length} THEN 20 ELSE 0 END`);
  }
  const conditions = ["generation_id=$1"];
  if (textConditions.length > 0) conditions.push(`(${textConditions.join(" OR ")})`);
  if (dateRange) {
    values.push(dateRange.from);
    conditions.push(`substr(COALESCE(occurred_at, updated_at, ''), 1, 10) >= $${values.length}`);
    values.push(dateRange.toExclusive);
    conditions.push(`substr(COALESCE(occurred_at, updated_at, ''), 1, 10) < $${values.length}`);
  }
  const rows = await database.select<GraphNodeRow[]>(`
    SELECT id,node_type,source_type,source_id,label,body,url,occurred_at,updated_at,metadata_json
    FROM context_graph_nodes
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${scoreExpressions.length > 0 ? `(${scoreExpressions.join(" + ")}) DESC,` : ""}
      CASE WHEN node_type='task' THEN 0 ELSE 1 END,
      COALESCE(updated_at, occurred_at, '') DESC, id
    LIMIT 120
  `, values);
  return rows.map(toGraphNode);
}

async function loadNeighborEdges(
  database: GraphDatabase,
  generationId: string,
  nodeIds: string[],
): Promise<ContextGraphEdge[]> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map((_, index) => `$${index + 2}`).join(",");
  const rows = await database.select<GraphEdgeRow[]>(`
    SELECT id,from_node_id,to_node_id,relation_type,derivation_kind,weight,evidence_json
    FROM context_graph_edges
    WHERE generation_id=$1
      AND (from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders}))
    ORDER BY weight DESC, id
    LIMIT 500
  `, [generationId, ...nodeIds]);
  return rows.map(toGraphEdge);
}

async function loadNodesById(
  database: GraphDatabase,
  generationId: string,
  nodeIds: string[],
): Promise<ContextGraphNode[]> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map((_, index) => `$${index + 2}`).join(",");
  const rows = await database.select<GraphNodeRow[]>(`
    SELECT id,node_type,source_type,source_id,label,body,url,occurred_at,updated_at,metadata_json
    FROM context_graph_nodes WHERE generation_id=$1 AND id IN (${placeholders})
  `, [generationId, ...nodeIds]);
  return rows.map(toGraphNode);
}

export async function searchContextGraph(question: string, database?: GraphDatabase): Promise<ContextGraphSearchResult> {
  const connection = database ?? await getDatabase();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generationId = await currentReadyGeneration(connection);
    if (!generationId) return { generationId: "", nodes: [], edges: [] };
    const seedNodes = await loadSeedNodes(connection, generationId, question);
    const seeds = rankGraphCandidates(question, seedNodes);
    const nodes = new Map(seedNodes.map((node) => [node.id, node]));
    const edges = new Map<string, ContextGraphEdge>();
    let frontier = seeds.map(({ node }) => node.id);
    for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
      const neighborEdges = await loadNeighborEdges(connection, generationId, frontier);
      for (const edge of neighborEdges) edges.set(edge.id, edge);
      const neighborIds = [...new Set(neighborEdges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]))]
        .filter((id) => !nodes.has(id))
        .slice(0, 500);
      const neighborNodes = await loadNodesById(connection, generationId, neighborIds);
      for (const node of neighborNodes) nodes.set(node.id, node);
      frontier = neighborNodes.map((node) => node.id);
    }
    if (await currentReadyGeneration(connection) !== generationId) continue;
    const edgeList = [...edges.values()];
    const ranked = boundedGraphTraversal(seeds, [...nodes.values()], edgeList);
    const included = new Set(ranked.map(({ node }) => node.id));
    return {
      generationId,
      nodes: ranked,
      edges: edgeList.filter((edge) => included.has(edge.fromNodeId) && included.has(edge.toNodeId)),
    };
  }
  throw new Error("context_graph_generation_changed_during_search");
}

export async function loadContextGraphSnapshot(
  limit = 240,
  database?: GraphDatabase,
): Promise<ContextGraphSnapshot> {
  const connection = database ?? await getDatabase();
  const state = await ensureContextGraphIndex(connection);
  const safeLimit = Math.max(20, Math.min(500, Math.floor(limit)));
  const rows = await connection.select<GraphNodeRow[]>(`
    WITH degree AS (
      SELECT node_id, COUNT(*) edge_count FROM (
        SELECT from_node_id node_id FROM context_graph_edges WHERE generation_id=$1
        UNION ALL
        SELECT to_node_id node_id FROM context_graph_edges WHERE generation_id=$1
      ) GROUP BY node_id
    )
    SELECT n.id,n.node_type,n.source_type,n.source_id,n.label,n.body,n.url,n.occurred_at,n.updated_at,n.metadata_json
    FROM context_graph_nodes n
    LEFT JOIN degree d ON d.node_id=n.id
    WHERE n.generation_id=$1
    ORDER BY CASE WHEN n.node_type='task' THEN 0 ELSE 1 END,
      COALESCE(d.edge_count, 0) DESC,
      COALESCE(n.updated_at, n.occurred_at, '') DESC,
      n.id
    LIMIT $2
  `, [state.generationId, safeLimit]);
  const nodes = rows.map(toGraphNode);
  const ids = nodes.map((node) => node.id);
  if (ids.length === 0) return { ...state, nodes, edges: [] };
  const placeholders = ids.map((_, index) => `$${index + 2}`).join(",");
  const edgeRows = await connection.select<GraphEdgeRow[]>(`
    SELECT id,from_node_id,to_node_id,relation_type,derivation_kind,weight,evidence_json
    FROM context_graph_edges
    WHERE generation_id=$1
      AND from_node_id IN (${placeholders})
      AND to_node_id IN (${placeholders})
    ORDER BY weight DESC, id
    LIMIT 1600
  `, [state.generationId, ...ids]);
  return { ...state, nodes, edges: edgeRows.map(toGraphEdge) };
}

export const formatContextGraphResults = formatGraphContext;
