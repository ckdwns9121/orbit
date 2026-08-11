import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../model/chat";
import { taskProposalFromToolCall, type ChatTaskProposal, type CreateTaskToolCall } from "../model/chat-task-proposal";
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
import { listWorkItems } from "./work-item-repository";

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

interface ChatStreamEvent {
  kind: "started" | "delta" | "completed" | "cancelled";
  delta?: string;
  responseId?: string;
}

interface StreamCallbacks {
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onSource: (source: ContextSourceStatus) => void;
}

export interface StreamAnswer {
  content: string;
  responseId: string | null;
  cancelled: boolean;
  taskProposals: ChatTaskProposal[];
}

interface ChatToolPlan {
  calls: ChatToolCall[];
}

interface SearchChatToolCall {
  callId: string;
  name: "search_slack_messages" | "search_confluence_pages";
  arguments: unknown;
}

type ChatToolCall = SearchChatToolCall | CreateTaskToolCall;

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

async function executeToolCall(
  call: SearchChatToolCall,
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

function approvalRequiredToolResult(call: CreateTaskToolCall, proposal: ChatTaskProposal | null) {
  const result = proposal
    ? { ok: false, status: "approval_required", title: proposal.title, description: proposal.description }
    : { ok: false, status: "invalid_arguments", error: "A non-empty title is required." };
  return {
    call: { type: "function_call", call_id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) },
    output: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) },
  };
}

export async function streamAnswerWithOrbitContext(
  question: string,
  messages: ChatMessage[],
  model: string,
  callbacks: StreamCallbacks,
): Promise<StreamAnswer> {
  const conversation = messages.slice(-12).map((message) => ({ role: message.role, content: message.content }));
  const planningStatus = (id: "slack" | "confluence") => {
    const source = contextSource(id);
    callbacks.onSource({ ...source, state: "collecting", detail: "AI가 검색 조건 분석 중…" });
  };
  planningStatus("slack");
  planningStatus("confluence");
  const now = new Date();
  const baseContext = await buildOrbitContext(now, callbacks.onSource);
  const completionGrounding = await buildCompletedWorkGrounding(question);
  const graphGrounding = await buildKnowledgeGraphGrounding(question, callbacks.onSource);
  const context = composeOrbitGrounding(baseContext, completionGrounding, graphGrounding);
  const plan = await invoke<ChatToolPlan>("plan_chat_tools", {
    model,
    question,
    conversation,
    context,
    localDate: new Intl.DateTimeFormat("sv-SE").format(new Date()),
  });
  const taskProposals = plan.calls
    .filter((call): call is CreateTaskToolCall => call.name === "create_task")
    .map(taskProposalFromToolCall)
    .filter((proposal): proposal is ChatTaskProposal => proposal !== null);
  const executed = await Promise.all(plan.calls.map((call) => call.name === "create_task"
    ? approvalRequiredToolResult(call, taskProposalFromToolCall(call))
    : executeToolCall(call, callbacks.onSource)));
  for (const id of ["slack", "confluence"] as const) {
    if (!plan.calls.some((call) => call.name === (id === "slack" ? "search_slack_messages" : "search_confluence_pages"))) {
      const source = contextSource(id);
      callbacks.onSource({ ...source, state: "complete", count: 0, detail: "이번 질문에는 검색 불필요" });
    }
  }
  if (callbacks.signal?.aborted) return { content: "", responseId: null, cancelled: true, taskProposals: [] };

  const requestId = crypto.randomUUID();
  const channel = new Channel<ChatStreamEvent>();
  let content = "";
  let responseId: string | null = null;
  let cancelled = false;
  channel.onmessage = (event) => {
    if (event.kind === "delta" && event.delta) {
      content += event.delta;
      callbacks.onDelta(event.delta);
    } else if ((event.kind === "started" || event.kind === "completed") && event.responseId) {
      responseId = event.responseId;
    } else if (event.kind === "cancelled") {
      cancelled = true;
    }
  };

  const cancel = () => { void invoke("cancel_chat_stream", { requestId }); };
  callbacks.signal?.addEventListener("abort", cancel, { once: true });
  try {
    await invoke("stream_chat_with_orbit_context", {
      request: {
        requestId,
        model,
        question,
        context,
        conversation,
        toolCalls: executed.map((item) => item.call),
        toolOutputs: executed.map((item) => item.output),
      },
      onEvent: channel,
    });
    return {
      content,
      responseId,
      cancelled: cancelled || Boolean(callbacks.signal?.aborted),
      taskProposals: cancelled || callbacks.signal?.aborted ? [] : taskProposals,
    };
  } finally {
    callbacks.signal?.removeEventListener("abort", cancel);
  }
}
