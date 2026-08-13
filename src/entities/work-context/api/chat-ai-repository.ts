import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../model/chat";
import type { ChatAgentApproval, ChatAgentMutationTool, ChatAgentRun, ChatAgentStepView } from "../model/chat-agent";
import { listAiSessions } from "./ai-session-repository";
import { addWorkItemToDailyPlan } from "./daily-plan-repository";
import {
  createAgentApprovals,
  createChatAgentRun,
  getChatAgentRun,
  listRunAgentApprovals,
  saveChatAgentRun,
  updateAgentApproval,
} from "./chat-agent-repository";
import { listCalendarEvents } from "./calendar-event-repository";
import { searchCompletedWork, type CompletedWorkSearchResult } from "./completion-repository";
import { searchConfluencePagesWithProvenance } from "./confluence-page-repository";
import {
  ensureContextGraphIndex,
  formatContextGraphResults,
  searchContextGraph,
} from "./context-graph-repository";
import { listCachedPullRequests } from "./github-pull-request-repository";
import { listCachedJiraIssues } from "./jira-issue-repository";
import { queryCacheWarning, type QueryCacheProvenance } from "./query-cache-provenance";
import { safeSyncErrorSummary } from "./source-sync-repository";
import { searchSlackMessagesWithProvenance } from "./slack-message-repository";
import { createWorkItem, listWorkItems, updateWorkItemPriority, updateWorkItemTargetAt, updateWorkItemTitle } from "./work-item-repository";

export type ContextSourceId = "tasks" | "calendar" | "jira" | "github" | "graph" | "slack" | "confluence";
export type ContextSourceState = "pending" | "collecting" | "complete" | "unavailable" | "error";

export interface ContextSourceStatus {
  id: ContextSourceId;
  label: string;
  state: ContextSourceState;
  count?: number;
  detail: string;
}

export const initialContextSources: ContextSourceStatus[] = [
  { id: "tasks", label: "Task", state: "pending", detail: "수집 대기" },
  { id: "calendar", label: "Calendar", state: "pending", detail: "수집 대기" },
  { id: "jira", label: "Jira", state: "pending", detail: "탐색 대기" },
  { id: "github", label: "GitHub", state: "pending", detail: "탐색 대기" },
  { id: "graph", label: "Knowledge Graph", state: "pending", detail: "인덱스 확인 대기" },
  { id: "slack", label: "Slack", state: "pending", detail: "메시지 탐색 대기" },
  { id: "confluence", label: "Confluence", state: "pending", detail: "문서 탐색 대기" },
];

function contextSource(id: ContextSourceId): ContextSourceStatus {
  const source = initialContextSources.find((item) => item.id === id);
  if (!source) throw new Error(`Unknown context source: ${id}`);
  return source;
}

interface StreamCallbacks {
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onSource: (source: ContextSourceStatus) => void;
  onSteps?: (steps: ChatAgentStepView[]) => void;
}

export interface StreamAnswer {
  content: string;
  responseId: string | null;
  cancelled: boolean;
  approvals: ChatAgentApproval[];
  runId: string;
  steps: ChatAgentStepView[];
}

interface ChatAgentStepResponse {
  responseId: string | null;
  content: string;
  calls: ChatToolCall[];
}

interface ChatToolCall {
  callId: string;
  name: string;
  arguments: unknown;
}

interface SearchToolArguments {
  query: string;
  dateFrom: string | null;
  dateTo: string | null;
}

type CompletedWorkSearcher = typeof searchCompletedWork;

const completedWorkQuestionPatterns = [
  /(?:완료|끝낸|마친|종료된)\s*(?:한|했던|된)?[^.!?\n]{0,60}(?:업무|작업|태스크)/,
  /(?:완료|끝낸|마친|종료된)\s*(?:한|했던|된)?\s*일/,
  /(?:지난|이전|과거|예전(?:에)?)\s*(?:의|에|했던)?\s*(?:일|업무|작업|태스크)/,
  /(?:성과|회고|결정(?:사항)?|시행착오|실패|리스크).*(?:찾|검색|알려|뭐|무엇)/,
  /(?:찾|검색|알려).*(?:성과|회고|결정(?:사항)?|시행착오|실패|리스크)/,
  /\b(?:completed?|finished|done|previous|prior|past)\s+(?:work|task|project)s?\b/i,
  /\b(?:retrospective|decision|risk|lesson)s?\b/i,
];

export function asksAboutCompletedWork(question: string): boolean {
  return completedWorkQuestionPatterns.some((pattern) => pattern.test(question));
}

function compactContextValue(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit) || "기록 없음";
}

function formatCompletionEvidence(result: CompletedWorkSearchResult): string {
  if (result.evidence.length === 0) return "저장된 근거 링크 없음";
  return result.evidence.slice(0, 12).map((evidence) => {
    const label = compactContextValue(evidence.label, 200);
    const excerpt = evidence.excerpt ? ` — ${compactContextValue(evidence.excerpt, 400)}` : "";
    return evidence.url ? `[${label}](${evidence.url})${excerpt}` : `${label}${excerpt}`;
  }).join("; ");
}

function formatCompletedWork(result: CompletedWorkSearchResult): string {
  return [
    `- 작업: ${compactContextValue(result.workItemTitle, 300)}`,
    `  완료 시각: ${result.completedAt}`,
    `  결과: ${compactContextValue(result.resultSummary, 1_500)}`,
    `  결정: ${compactContextValue(result.decisions, 1_500)}`,
    `  남은 위험: ${compactContextValue(result.remainingRisk, 1_000)}`,
    `  회고: ${compactContextValue(result.retrospective, 1_500)}`,
    `  근거: ${formatCompletionEvidence(result)}`,
    `  기록 출처: ${result.provenance === "legacy-inferred" ? "레거시 상태에서 추론됨" : "사용자가 저장한 완료 기록"}`,
  ].join("\n");
}

export async function buildCompletedWorkGrounding(
  question: string,
  searcher: CompletedWorkSearcher = searchCompletedWork,
): Promise<string> {
  if (!asksAboutCompletedWork(question)) return "";
  try {
    const results = await searcher({ state: "active", limit: 50 });
    if (results.length === 0) {
      return [
        "[Completed Work — 저장 기록 근거]",
        "검색 결과: 저장된 완료 작업이 없습니다.",
        "응답 규칙: 완료 작업, 결정, 실패, 위험 또는 근거가 있었다고 추론하거나 만들어내지 마세요.",
      ].join("\n");
    }
    return [
      "[Completed Work — 저장 기록 근거]",
      `검색 결과: ${results.length}건. 질문과 관련된 기록만 사용하고, 아래에 없는 사실은 추가하지 마세요.`,
      results.map(formatCompletedWork).join("\n"),
    ].join("\n").slice(0, 30_000);
  } catch (cause) {
    const detail = cause instanceof Error ? compactContextValue(cause.message, 300) : "알 수 없는 조회 오류";
    return [
      "[Completed Work — 저장 기록 근거]",
      `검색 실패: ${detail}`,
      "응답 규칙: 완료 기록을 확인할 수 없으므로 완료 작업에 관한 사실을 추론하거나 만들어내지 마세요.",
    ].join("\n");
  }
}

async function collectSource<T>(
  source: ContextSourceStatus,
  loader: () => Promise<T[]>,
  onSource: (source: ContextSourceStatus) => void,
): Promise<T[]> {
  onSource({ ...source, state: "collecting", detail: source.id === "jira" || source.id === "github" || source.id === "slack" || source.id === "confluence" ? "탐색 중…" : "수집 중…" });
  try {
    const items = await loader();
    onSource({ ...source, state: "complete", count: items.length, detail: `${items.length}건 수집 완료` });
    return items;
  } catch (cause) {
    onSource({ ...source, state: "error", detail: cause instanceof Error ? cause.message : "수집 실패" });
    return [];
  }
}

export async function buildOrbitContext(
  now = new Date(),
  onSource: (source: ContextSourceStatus) => void = () => undefined,
): Promise<string> {
  const from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
  const to = new Date(now); to.setDate(to.getDate() + 30); to.setHours(23, 59, 59, 999);
  const [tasks, events, jira, pullRequests] = await Promise.all([
    collectSource(contextSource("tasks"), listWorkItems, onSource),
    collectSource(contextSource("calendar"), () => listCalendarEvents(from, to), onSource),
    collectSource(contextSource("jira"), listCachedJiraIssues, onSource),
    collectSource(contextSource("github"), listCachedPullRequests, onSource),
  ]);
  const sections = [
    `[기준 시각] ${now.toISOString()}`,
    "[Task]\n" + tasks.slice(0, 40).map((task) => `- ${task.title} | 상태=${task.status} | 다음=${task.nextAction ?? "없음"} | 체크포인트=${task.checkpoint ?? "없음"}`).join("\n"),
    "[Calendar]\n" + events.slice(0, 80).map((event) => `- ${event.startAt}~${event.endAt} | ${event.title} | 장소=${event.location ?? "없음"}${event.externalUrl ? ` | ${event.externalUrl}` : ""}`).join("\n"),
    "[Jira]\n" + jira.slice(0, 50).map((issue) => `- ${issue.key} ${issue.summary} | ${issue.status} | ${issue.url}`).join("\n"),
    "[GitHub PR]\n" + pullRequests.slice(0, 40).map((pr) => `- ${pr.repository}#${pr.number} ${pr.title} | updated=${pr.updatedAt} | ${pr.url}`).join("\n"),
  ];
  return sections.join("\n\n").slice(0, 60_000);
}

type GraphGroundingPorts = {
  ensureIndex: typeof ensureContextGraphIndex;
  search: typeof searchContextGraph;
  format: typeof formatContextGraphResults;
};

const graphGroundingPorts: GraphGroundingPorts = {
  ensureIndex: ensureContextGraphIndex,
  search: searchContextGraph,
  format: formatContextGraphResults,
};

export function composeOrbitGrounding(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}

export async function buildKnowledgeGraphGrounding(
  question: string,
  onSource: (source: ContextSourceStatus) => void = () => undefined,
  ports: GraphGroundingPorts = graphGroundingPorts,
): Promise<string> {
  const source = contextSource("graph");
  onSource({ ...source, state: "collecting", detail: "관계 인덱스 확인 중…" });
  try {
    const index = await ports.ensureIndex();
    onSource({ ...source, state: "collecting", detail: "관련 맥락 탐색 중…" });
    const result = await ports.search(question);
    const detail = index.rebuilt
      ? `${result.nodes.length}건 연결 완료 · 인덱스 갱신됨`
      : `${result.nodes.length}건 연결 완료`;
    onSource({ ...source, state: "complete", count: result.nodes.length, detail });
    return ports.format(result);
  } catch (cause) {
    onSource({ ...source, state: "error", detail: safeSyncErrorSummary(cause) || "그래프 탐색 실패" });
    return "";
  }
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function previousIsoDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function parseSearchToolArguments(value: unknown): SearchToolArguments {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    query: typeof input.query === "string" ? input.query.trim().replace(/\s+/g, " ").slice(0, 160) : "",
    dateFrom: normalizeIsoDate(input.date_from),
    dateTo: normalizeIsoDate(input.date_to),
  };
}

export function buildSlackToolQuery(arguments_: SearchToolArguments): string {
  const parts = [arguments_.query];
  if (arguments_.dateFrom) parts.push(`after:${previousIsoDate(arguments_.dateFrom)}`);
  if (arguments_.dateTo) parts.push(`before:${arguments_.dateTo}`);
  return parts.filter(Boolean).join(" ");
}

export function buildConfluenceToolCql(arguments_: SearchToolArguments): string {
  const query = arguments_.query.replace(/["\\\u0000-\u001f]/g, "").trim();
  const clauses = ["type = page", "status = current"];
  if (query) clauses.push(`text ~ "${query}"`);
  if (arguments_.dateFrom) clauses.push(`lastmodified >= "${arguments_.dateFrom}"`);
  if (arguments_.dateTo) clauses.push(`lastmodified < "${arguments_.dateTo}"`);
  return clauses.join(" AND ");
}

export function buildChatQueryCacheContext(label: string, provenance: QueryCacheProvenance) {
  return {
    origin: provenance.origin,
    freshness: provenance.freshness,
    lastAttemptAt: provenance.lastAttemptAt,
    lastSuccessAt: provenance.lastSuccessAt,
    remoteErrorCategory: provenance.errorCategory,
    remoteError: provenance.errorSummary,
    warning: queryCacheWarning(label, provenance),
  };
}

async function executeSearchToolCall(
  call: ChatToolCall,
  onSource: (source: ContextSourceStatus) => void,
): Promise<{ call: Record<string, unknown>; output: Record<string, unknown> }> {
  const arguments_ = parseSearchToolArguments(call.arguments);
  const source = contextSource(call.name === "search_slack_messages" ? "slack" : "confluence");
  onSource({ ...source, state: "collecting", detail: `${arguments_.query || "날짜 조건"} 검색 중…` });
  let result: unknown;
  try {
    if (call.name === "search_slack_messages") {
      const search = await searchSlackMessagesWithProvenance(buildSlackToolQuery(arguments_));
      const cacheContext = buildChatQueryCacheContext("Slack", search.provenance);
      result = { ok: true, ...cacheContext, messages: search.items.slice(0, 30).map((message) => ({
        channel: message.channelName || message.channelId,
        author: message.userName,
        text: message.text.slice(0, 1_500),
        timestamp: message.messageTs,
        url: message.permalink,
      })) };
      onSource({
        ...source,
        state: search.provenance.freshness === "stale-cache" ? "error" : "complete",
        count: search.items.length,
        detail: cacheContext.warning ?? `${search.items.length}건 수집 완료`,
      });
    } else {
      const search = await searchConfluencePagesWithProvenance(buildConfluenceToolCql(arguments_));
      const cacheContext = buildChatQueryCacheContext("Confluence", search.provenance);
      result = { ok: true, ...cacheContext, pages: search.items.slice(0, 30).map((page) => ({
        title: page.title,
        space: page.spaceKey,
        excerpt: page.excerpt.slice(0, 1_500),
        lastModified: page.lastModified,
        url: page.url,
      })) };
      onSource({
        ...source,
        state: search.provenance.freshness === "stale-cache" ? "error" : "complete",
        count: search.items.length,
        detail: cacheContext.warning ?? `${search.items.length}건 수집 완료`,
      });
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    result = { ok: false, error };
    onSource({ ...source, state: "error", detail: error });
  }
  return {
    call: { type: "function_call", call_id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) },
    output: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) },
  };
}

const mutationTools = new Set<ChatAgentMutationTool>(["create_task", "update_task", "add_task_to_planner"]);
const MAX_AGENT_ITERATIONS = 8;
const MAX_AGENT_TOOL_CALLS = 20;

function callItem(call: ChatToolCall): Record<string, unknown> {
  return { type: "function_call", call_id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) };
}

function outputItem(callId: string, value: unknown): Record<string, unknown> {
  return { type: "function_call_output", call_id: callId, output: JSON.stringify(value) };
}

function toolLabel(name: string): string {
  return ({
    list_tasks: "Task 확인", list_calendar_events: "Calendar 확인", list_jira_issues: "Jira 확인",
    list_pull_requests: "Pull Request 확인", list_ai_sessions: "AI 세션 확인",
    search_knowledge_graph: "연결 컨텍스트 탐색", search_slack_messages: "Slack 검색",
    search_confluence_pages: "Confluence 검색", create_task: "Task 생성 승인 대기",
    update_task: "Task 수정 승인 대기", add_task_to_planner: "Planner 추가 승인 대기",
  } as Record<string, string>)[name] || name;
}

function textArgument(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

async function executeReadTool(call: ChatToolCall, onSource: StreamCallbacks["onSource"]): Promise<Record<string, unknown>> {
  if (call.name === "search_slack_messages" || call.name === "search_confluence_pages") {
    return (await executeSearchToolCall(call, onSource)).output;
  }
  const input = typeof call.arguments === "object" && call.arguments !== null ? call.arguments as Record<string, unknown> : {};
  const query = textArgument(input.query);
  try {
    if (call.name === "list_tasks") {
      const status = textArgument(input.status);
      const tasks = (await listWorkItems()).filter((task) => (!status || task.status === status) && (!query || `${task.title} ${task.goal || ""} ${task.nextAction || ""}`.toLocaleLowerCase().includes(query))).slice(0, 80);
      return outputItem(call.callId, { ok: true, tasks });
    }
    if (call.name === "list_calendar_events") {
      const from = new Date(`${String(input.date_from)}T00:00:00`);
      const to = new Date(`${String(input.date_to)}T23:59:59.999`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return outputItem(call.callId, { ok: false, error: "invalid_date_range" });
      return outputItem(call.callId, { ok: true, events: (await listCalendarEvents(from, to)).slice(0, 100) });
    }
    if (call.name === "list_jira_issues") {
      const issues = (await listCachedJiraIssues()).filter((issue) => !query || `${issue.key} ${issue.summary} ${issue.status}`.toLocaleLowerCase().includes(query)).slice(0, 80);
      return outputItem(call.callId, { ok: true, issues });
    }
    if (call.name === "list_pull_requests") {
      const relation = textArgument(input.relation);
      const pullRequests = (await listCachedPullRequests()).filter((pr) => (!relation || (relation === "authored" ? pr.authoredByViewer : pr.reviewRequested)) && (!query || `${pr.repository} ${pr.title}`.toLocaleLowerCase().includes(query))).slice(0, 80);
      return outputItem(call.callId, { ok: true, pullRequests });
    }
    if (call.name === "list_ai_sessions") {
      const sessions = (await listAiSessions()).filter((session) => !query || `${session.customTitle || session.title} ${session.cwd || ""} ${session.lastPrompt || ""}`.toLocaleLowerCase().includes(query)).slice(0, 60).map((session) => ({ provider: session.provider, sessionId: session.sessionId, title: session.customTitle || session.title, cwd: session.cwd, model: session.model, lastPrompt: session.lastPrompt?.slice(0, 800), updatedAt: session.updatedAt, linkedWorkItemId: session.linkedWorkItemId }));
      return outputItem(call.callId, { ok: true, sessions });
    }
    if (call.name === "search_knowledge_graph") {
      await ensureContextGraphIndex();
      const result = await searchContextGraph(String(input.query || ""));
      return outputItem(call.callId, { ok: true, context: formatContextGraphResults(result) });
    }
    return outputItem(call.callId, { ok: false, error: "unsupported_tool" });
  } catch (cause) {
    return outputItem(call.callId, { ok: false, error: cause instanceof Error ? cause.message : String(cause) });
  }
}

async function continueAgent(run: ChatAgentRun, callbacks: StreamCallbacks): Promise<StreamAnswer> {
  const steps: ChatAgentStepView[] = [];
  while (run.iteration < MAX_AGENT_ITERATIONS && run.toolCount < MAX_AGENT_TOOL_CALLS) {
    if (callbacks.signal?.aborted) {
      run.status = "cancelled";
      await saveChatAgentRun(run);
      return { content: "", responseId: run.responseId, cancelled: true, approvals: [], runId: run.id, steps };
    }
    steps.push({ id: `thinking-${run.iteration}`, label: run.iteration ? "도구 결과를 바탕으로 다음 행동 판단" : "요청 분석 및 실행 계획 수립", state: "running" });
    callbacks.onSteps?.([...steps]);
    const response = await invoke<ChatAgentStepResponse>("run_chat_agent_step", {
      model: run.model, question: run.question, conversation: run.conversation, context: run.context,
      localDate: new Intl.DateTimeFormat("sv-SE").format(new Date()), transcript: run.transcript,
    });
    steps[steps.length - 1].state = "complete";
    run.iteration += 1;
    run.responseId = response.responseId;
    if (response.calls.length === 0) {
      const content = response.content.trim() || "확인 가능한 정보를 모두 살펴봤지만 답변을 구성하지 못했습니다.";
      run.status = "completed";
      await saveChatAgentRun(run);
      callbacks.onSteps?.([...steps]);
      callbacks.onDelta(content);
      return { content, responseId: run.responseId, cancelled: false, approvals: [], runId: run.id, steps };
    }
    if (run.toolCount + response.calls.length > MAX_AGENT_TOOL_CALLS) break;
    run.toolCount += response.calls.length;
    run.transcript.push(...response.calls.map(callItem));
    const mutations = response.calls.filter((call): call is ChatToolCall & { name: ChatAgentMutationTool } => mutationTools.has(call.name as ChatAgentMutationTool));
    for (const call of response.calls.filter((item) => !mutationTools.has(item.name as ChatAgentMutationTool))) {
      const step: ChatAgentStepView = { id: call.callId, label: toolLabel(call.name), state: "running" };
      steps.push(step); callbacks.onSteps?.([...steps]);
      run.transcript.push(await executeReadTool(call, callbacks.onSource));
      step.state = "complete"; callbacks.onSteps?.([...steps]);
    }
    if (mutations.length) {
      const approvals = await createAgentApprovals(run.id, mutations);
      run.status = "awaiting_approval";
      await saveChatAgentRun(run);
      steps.push(...approvals.map((approval) => ({ id: approval.id, label: toolLabel(approval.toolName), state: "waiting" as const })));
      callbacks.onSteps?.([...steps]);
      return { content: response.content.trim(), responseId: run.responseId, cancelled: false, approvals, runId: run.id, steps };
    }
    await saveChatAgentRun(run);
  }
  const content = `안전을 위해 에이전트 실행을 ${run.iteration}회 판단·${run.toolCount}개 도구에서 중단했습니다. 요청 범위를 좁혀 다시 시도해주세요.`;
  run.status = "failed";
  await saveChatAgentRun(run);
  callbacks.onDelta(content);
  return { content, responseId: run.responseId, cancelled: false, approvals: [], runId: run.id, steps };
}

export async function streamAnswerWithOrbitContext(question: string, messages: ChatMessage[], model: string, threadId: string, callbacks: StreamCallbacks): Promise<StreamAnswer> {
  const conversation = messages.slice(-12).map((message) => ({ role: message.role, content: message.content }));
  const now = new Date();
  const context = composeOrbitGrounding(
    await buildOrbitContext(now, callbacks.onSource),
    await buildCompletedWorkGrounding(question),
    await buildKnowledgeGraphGrounding(question, callbacks.onSource),
  );
  const run = await createChatAgentRun({ threadId, question, model, context, conversation });
  return continueAgent(run, callbacks);
}

async function executeApprovedMutation(approval: ChatAgentApproval): Promise<Record<string, unknown>> {
  const input = approval.arguments;
  if (approval.toolName === "create_task") {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("Task 제목이 비어 있습니다.");
    const id = await createWorkItem({ title, status: "todo", goal: typeof input.description === "string" ? input.description : undefined });
    return { ok: true, taskId: id, title };
  }
  const taskId = String(input.task_id || "");
  if (!(await listWorkItems()).some((item) => item.id === taskId)) throw new Error("Task를 찾을 수 없습니다.");
  if (approval.toolName === "update_task") {
    if (typeof input.title === "string" && input.title.trim()) await updateWorkItemTitle(taskId, input.title);
    if (input.priority === "p1" || input.priority === "p2" || input.priority === "p3") await updateWorkItemPriority(taskId, input.priority);
    if (typeof input.target_at === "string") await updateWorkItemTargetAt(taskId, input.target_at);
    return { ok: true, taskId };
  }
  const planDate = String(input.plan_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) throw new Error("Planner 날짜가 올바르지 않습니다.");
  await addWorkItemToDailyPlan(taskId, planDate);
  return { ok: true, taskId, planDate };
}

export async function resolveChatAgentApproval(approval: ChatAgentApproval, approved: boolean, callbacks: StreamCallbacks): Promise<StreamAnswer | null> {
  if (approval.status !== "pending" && approval.status !== "failed") return null;
  await updateAgentApproval(approval.id, "executing");
  let result: Record<string, unknown>;
  try {
    result = approved ? await executeApprovedMutation(approval) : { ok: false, status: "rejected_by_user" };
    await updateAgentApproval(approval.id, approved ? "approved" : "rejected", result);
  } catch (cause) {
    await updateAgentApproval(approval.id, "failed", null, cause instanceof Error ? cause.message : String(cause));
    throw cause;
  }
  const approvals = await listRunAgentApprovals(approval.runId);
  if (approvals.some((item) => item.status === "pending" || item.status === "executing" || item.status === "failed")) return null;
  const run = await getChatAgentRun(approval.runId);
  if (!run || run.status !== "awaiting_approval") return null;
  for (const item of approvals) run.transcript.push(outputItem(item.callId, item.result || { ok: false, status: item.status }));
  run.status = "running";
  await saveChatAgentRun(run);
  return continueAgent(run, callbacks);
}
