import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../domain/chat";
import { listCalendarEvents } from "./calendar-event-repository";
import { searchConfluencePages } from "./confluence-page-repository";
import { listCachedPullRequests } from "./github-pull-request-repository";
import { listCachedJiraIssues } from "./jira-issue-repository";
import { getAppSettings } from "./settings-repository";
import { searchSlackMessages } from "./slack-message-repository";
import { listWorkItems } from "./work-item-repository";

export type ContextSourceId = "tasks" | "calendar" | "jira" | "github" | "slack" | "confluence";
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
  { id: "slack", label: "Slack", state: "pending", detail: "메시지 탐색 대기" },
  { id: "confluence", label: "Confluence", state: "pending", detail: "문서 탐색 대기" },
];

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
}

interface ChatToolPlan {
  calls: ChatToolCall[];
}

interface ChatToolCall {
  callId: string;
  name: "search_slack_messages" | "search_confluence_pages";
  arguments: unknown;
}

interface SearchToolArguments {
  query: string;
  dateFrom: string | null;
  dateTo: string | null;
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
  const source = (id: ContextSourceId) => initialContextSources.find((item) => item.id === id)!;
  const [tasks, events, jira, pullRequests] = await Promise.all([
    collectSource(source("tasks"), listWorkItems, onSource),
    collectSource(source("calendar"), () => listCalendarEvents(from, to), onSource),
    collectSource(source("jira"), listCachedJiraIssues, onSource),
    collectSource(source("github"), listCachedPullRequests, onSource),
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

async function executeToolCall(
  call: ChatToolCall,
  onSource: (source: ContextSourceStatus) => void,
): Promise<{ call: Record<string, unknown>; output: Record<string, unknown> }> {
  const arguments_ = parseSearchToolArguments(call.arguments);
  const source = initialContextSources.find((item) => item.id === (call.name === "search_slack_messages" ? "slack" : "confluence"))!;
  onSource({ ...source, state: "collecting", detail: `${arguments_.query || "날짜 조건"} 검색 중…` });
  let result: unknown;
  try {
    if (call.name === "search_slack_messages") {
      const messages = await searchSlackMessages(buildSlackToolQuery(arguments_));
      result = { ok: true, messages: messages.slice(0, 30).map((message) => ({
        channel: message.channelName || message.channelId,
        author: message.userName,
        text: message.text.slice(0, 1_500),
        timestamp: message.messageTs,
        url: message.permalink,
      })) };
      onSource({ ...source, state: "complete", count: messages.length, detail: `${messages.length}건 수집 완료` });
    } else {
      const pages = await searchConfluencePages(buildConfluenceToolCql(arguments_));
      result = { ok: true, pages: pages.slice(0, 30).map((page) => ({
        title: page.title,
        space: page.spaceKey,
        excerpt: page.excerpt.slice(0, 1_500),
        lastModified: page.lastModified,
        url: page.url,
      })) };
      onSource({ ...source, state: "complete", count: pages.length, detail: `${pages.length}건 수집 완료` });
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

export async function streamAnswerWithOrbitContext(
  question: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
): Promise<StreamAnswer> {
  const settings = await getAppSettings();
  const conversation = messages.slice(-12).map((message) => ({ role: message.role, content: message.content }));
  const planningStatus = (id: "slack" | "confluence") => {
    const source = initialContextSources.find((item) => item.id === id)!;
    callbacks.onSource({ ...source, state: "collecting", detail: "AI가 검색 조건 분석 중…" });
  };
  planningStatus("slack");
  planningStatus("confluence");
  const [context, plan] = await Promise.all([
    buildOrbitContext(new Date(), callbacks.onSource),
    invoke<ChatToolPlan>("plan_chat_tools", {
      model: settings.openai_model || null,
      question,
      conversation,
      localDate: new Intl.DateTimeFormat("sv-SE").format(new Date()),
    }),
  ]);
  const executed = await Promise.all(plan.calls.map((call) => executeToolCall(call, callbacks.onSource)));
  for (const id of ["slack", "confluence"] as const) {
    if (!plan.calls.some((call) => call.name === (id === "slack" ? "search_slack_messages" : "search_confluence_pages"))) {
      const source = initialContextSources.find((item) => item.id === id)!;
      callbacks.onSource({ ...source, state: "complete", count: 0, detail: "이번 질문에는 검색 불필요" });
    }
  }
  if (callbacks.signal?.aborted) return { content: "", responseId: null, cancelled: true };

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
        model: settings.openai_model || null,
        question,
        context,
        conversation,
        toolCalls: executed.map((item) => item.call),
        toolOutputs: executed.map((item) => item.output),
      },
      onEvent: channel,
    });
    return { content, responseId, cancelled: cancelled || Boolean(callbacks.signal?.aborted) };
  } finally {
    callbacks.signal?.removeEventListener("abort", cancel);
  }
}
