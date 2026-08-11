import type { WorkItemStatus } from "../model/work-item";
import type Database from "@tauri-apps/plugin-sql";
import { TransitionConflictError } from "../model/work-continuity";
import { getDatabase } from "./database";
import { transitionWorkItem } from "./work-continuity-repository";

export interface CompletionEvidence {
  source: "jira" | "github_pr" | "github_commit" | "slack" | "ai";
  sourceId: string;
  label: string;
  url: string | null;
  excerpt?: string | null;
}

export interface CompletionEpisode {
  id: string;
  workItemId: string;
  resultSummary: string;
  decisions: string;
  remainingRisk: string;
  retrospective: string;
  jiraProjectKey: string | null;
  evidence: CompletionEvidence[];
  provenance: "user" | "legacy-inferred";
  state: "active" | "superseded";
  baseWorkItemRevision: number;
  supersededAt: string | null;
  completedAt: string;
  createdAt: string;
}

export interface CompletedWorkSearchResult extends CompletionEpisode {
  workItemTitle: string;
  workItemStatus: WorkItemStatus;
}

export interface CompletedWorkPage {
  items: CompletedWorkSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

export interface CompletedWorkFilters {
  query?: string;
  from?: string;
  to?: string;
  jiraProjectKey?: string;
  source?: CompletionEvidence["source"];
  state?: CompletionEpisode["state"] | "all";
  limit?: number;
  offset?: number;
}

type CompletionReadDatabase = Pick<Database, "select">;

interface CompletionRow {
  id: string;
  work_item_id: string;
  result_summary: string;
  decisions: string;
  remaining_risk: string;
  retrospective: string;
  jira_project_key: string | null;
  evidence_json: string;
  provenance: CompletionEpisode["provenance"];
  state: CompletionEpisode["state"];
  base_work_item_revision: number;
  superseded_at: string | null;
  completed_at: string;
  created_at: string;
}

const completionFields = `c.id, c.work_item_id, c.result_summary, c.decisions,
  c.remaining_risk, c.retrospective, c.jira_project_key, c.evidence_json,
  c.provenance, c.state, c.base_work_item_revision, c.superseded_at,
  c.completed_at, c.created_at`;

function safeEvidence(evidence: CompletionEvidence[]): CompletionEvidence[] {
  return evidence.slice(0, 100).map((item) => ({
    source: item.source,
    sourceId: item.sourceId.slice(0, 240),
    label: item.label.replace(/(?:Bearer\s+\S+|(?:token|secret)\s*[:=]\s*\S+)/gi, "[REDACTED]").slice(0, 300),
    url: item.url?.slice(0, 2_000) ?? null,
    excerpt: item.excerpt?.replace(/(?:Bearer\s+\S+|(?:token|secret)\s*[:=]\s*\S+)/gi, "[REDACTED]").slice(0, 500) ?? null,
  }));
}

function parseEvidence(value: string): CompletionEvidence[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as CompletionEvidence[] : [];
  } catch {
    return [];
  }
}

function mapRow(row: CompletionRow): CompletionEpisode {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    resultSummary: row.result_summary,
    decisions: row.decisions,
    remainingRisk: row.remaining_risk,
    retrospective: row.retrospective,
    jiraProjectKey: row.jira_project_key,
    evidence: parseEvidence(row.evidence_json),
    provenance: row.provenance,
    state: row.state,
    baseWorkItemRevision: row.base_work_item_revision,
    supersededAt: row.superseded_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export async function completeWorkItem(input: {
  workItemId: string;
  expectedRevision: number;
  resultSummary: string;
  decisions: string;
  remainingRisk: string;
  retrospective: string;
  jiraProjectKey?: string | null;
  evidence?: CompletionEvidence[];
  completedAt?: string;
}): Promise<string> {
  if (!input.resultSummary.trim() || !input.decisions.trim()
    || !input.remainingRisk.trim() || !input.retrospective.trim()) {
    throw new Error("완료하려면 결과, 결정, 남은 위험, 다음에 다르게 할 점을 모두 기록해주세요.");
  }
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const completedAt = input.completedAt ?? new Date().toISOString();
  try {
    await database.execute(
      `INSERT INTO completion_records(
        id, work_item_id, result_summary, decisions, remaining_risk, retrospective,
        jira_project_key, evidence_json, provenance, state, base_work_item_revision,
        completed_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'user','active',$9,$10,$10)`,
      [id, input.workItemId, input.resultSummary.trim(), input.decisions.trim(),
        input.remainingRisk.trim(), input.retrospective.trim(),
        input.jiraProjectKey?.trim().toUpperCase() || null,
        JSON.stringify(safeEvidence(input.evidence ?? [])), input.expectedRevision, completedAt],
    );
  } catch (error) {
    if (String(error).includes("revision_conflict")) throw new TransitionConflictError();
    throw error;
  }
  return id;
}

export async function reopenWorkItem(
  workItemId: string,
  expectedRevision: number,
): Promise<void> {
  await transitionWorkItem({ workItemId, expectedRevision, targetStatus: "todo" });
}

export async function getActiveCompletion(workItemId: string): Promise<CompletionEpisode | null> {
  const database = await getDatabase();
  const rows = await database.select<CompletionRow[]>(
    `SELECT ${completionFields} FROM completion_records c
     WHERE c.work_item_id = $1 AND c.state = 'active'`,
    [workItemId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

function completionFilter(filters: CompletedWorkFilters) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  const add = (clause: string, value: string | number) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (filters.query?.trim()) {
    const token = `%${filters.query.trim().toLocaleLowerCase()}%`;
    const startIndex = values.length + 1;
    values.push(token, token, token, token, token, token);
    clauses.push(`(lower(w.title) LIKE $${startIndex}
      OR lower(c.result_summary) LIKE $${startIndex + 1}
      OR lower(c.decisions) LIKE $${startIndex + 2}
      OR lower(c.remaining_risk) LIKE $${startIndex + 3}
      OR lower(c.retrospective) LIKE $${startIndex + 4}
      OR lower(c.evidence_json) LIKE $${startIndex + 5})`);
  }
  if (filters.from) add("c.completed_at >= ?", filters.from);
  if (filters.to) add("c.completed_at < ?", filters.to);
  if (filters.jiraProjectKey) add("c.jira_project_key = ?", filters.jiraProjectKey.toUpperCase());
  if (filters.source) add("c.evidence_json LIKE ?", `%\"source\":\"${filters.source}\"%`);
  if (filters.state && filters.state !== "all") add("c.state = ?", filters.state);
  return { clauses, values };
}

export async function queryCompletedWorkPage(
  database: CompletionReadDatabase,
  filters: CompletedWorkFilters = {},
): Promise<CompletedWorkPage> {
  const { clauses, values } = completionFilter(filters);
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
  const countValues = [...values];
  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [countRows, rows] = await Promise.all([
    database.select<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
       FROM completion_records c JOIN work_items w ON w.id = c.work_item_id
       ${where}`,
      countValues,
    ),
    database.select<Array<CompletionRow & {
      work_item_title: string;
      work_item_status: WorkItemStatus;
    }>>(
      `SELECT ${completionFields}, w.title AS work_item_title, w.status AS work_item_status
       FROM completion_records c JOIN work_items w ON w.id = c.work_item_id
       ${where}
       ORDER BY c.completed_at DESC, c.id DESC LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
      values,
    ),
  ]);
  return {
    items: rows.map((row) => ({
      ...mapRow(row),
      workItemTitle: row.work_item_title,
      workItemStatus: row.work_item_status,
    })),
    total: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function searchCompletedWorkPage(
  filters: CompletedWorkFilters = {},
): Promise<CompletedWorkPage> {
  return queryCompletedWorkPage(await getDatabase(), filters);
}

export async function searchCompletedWork(
  filters: CompletedWorkFilters = {},
): Promise<CompletedWorkSearchResult[]> {
  return (await searchCompletedWorkPage(filters)).items;
}
