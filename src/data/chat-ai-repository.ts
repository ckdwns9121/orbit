import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../domain/chat";
import { listCalendarEvents } from "./calendar-event-repository";
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
  { id: "confluence", label: "Confluence", state: "unavailable", detail: "문서 연동 준비 중" },
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

async function collectSource<T>(
  source: ContextSourceStatus,
  loader: () => Promise<T[]>,
  onSource: (source: ContextSourceStatus) => void,
): Promise<T[]> {
  onSource({ ...source, state: "collecting", detail: source.id === "jira" || source.id === "github" || source.id === "slack" ? "탐색 중…" : "수집 중…" });
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
  slackQuery = "",
): Promise<string> {
  const from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
  const to = new Date(now); to.setDate(to.getDate() + 30); to.setHours(23, 59, 59, 999);
  const availableSources = initialContextSources.filter((source) => source.state !== "unavailable");
  initialContextSources.filter((source) => source.state === "unavailable").forEach(onSource);
  const [tasks, events, jira, pullRequests, slackMessages] = await Promise.all([
    collectSource(availableSources[0], listWorkItems, onSource),
    collectSource(availableSources[1], () => listCalendarEvents(from, to), onSource),
    collectSource(availableSources[2], listCachedJiraIssues, onSource),
    collectSource(availableSources[3], listCachedPullRequests, onSource),
    collectSource(availableSources[4], () => searchSlackMessages(slackQuery), onSource),
  ]);
  const sections = [
    `[기준 시각] ${now.toISOString()}`,
    "[Task]\n" + tasks.slice(0, 40).map((task) => `- ${task.title} | 상태=${task.status} | 다음=${task.nextAction ?? "없음"} | 체크포인트=${task.checkpoint ?? "없음"}`).join("\n"),
    "[Calendar]\n" + events.slice(0, 80).map((event) => `- ${event.startAt}~${event.endAt} | ${event.title} | 장소=${event.location ?? "없음"}${event.externalUrl ? ` | ${event.externalUrl}` : ""}`).join("\n"),
    "[Jira]\n" + jira.slice(0, 50).map((issue) => `- ${issue.key} ${issue.summary} | ${issue.status} | ${issue.url}`).join("\n"),
    `[Slack 검색어] ${slackQuery || "없음"}\n[Slack]\n` + slackMessages.slice(0, 40).map((message) => `- #${message.channelName || message.channelId} | ${message.userName || "알 수 없음"} | ${message.text} | ${message.permalink}`).join("\n"),
    "[GitHub PR]\n" + pullRequests.slice(0, 40).map((pr) => `- ${pr.repository}#${pr.number} ${pr.title} | updated=${pr.updatedAt} | ${pr.url}`).join("\n"),
    "[Confluence]\n- 아직 문서 수집기가 연결되지 않았습니다.",
  ];
  return sections.join("\n\n").slice(0, 60_000);
}

const slackSearchStopWords = new Set([
  "slack", "슬랙", "다시", "찾아봐", "찾아줘", "검색해줘", "확인해줘", "알려줘",
  "찾아줘봐", "관련", "내용", "메시지", "대화", "대화내용", "작업", "해줘", "뭐야",
  "어떻게", "있어", "있는",
]);

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function buildSlackDateFilter(text: string, now = new Date()): string {
  const exactDate = text.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (exactDate) {
    const date = localDate(Number(exactDate[1]), Number(exactDate[2]), Number(exactDate[3]));
    if (date) return `on:${formatLocalDate(date)}`;
  }
  const yearMonth = text.match(/(20\d{2})년\s*(\d{1,2})월/);
  if (yearMonth) {
    const start = localDate(Number(yearMonth[1]), Number(yearMonth[2]), 1);
    if (start) return `after:${formatLocalDate(addDays(start, -1))} before:${formatLocalDate(new Date(start.getFullYear(), start.getMonth() + 1, 1))}`;
  }
  const year = text.match(/(20\d{2})년/);
  if (year) return `after:${Number(year[1]) - 1}-12-31 before:${Number(year[1]) + 1}-01-01`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/오늘/.test(text)) return `on:${formatLocalDate(today)}`;
  if (/어제/.test(text)) return `on:${formatLocalDate(addDays(today, -1))}`;
  const recentDays = text.match(/최근\s*(\d{1,3})\s*일/);
  if (recentDays) return `after:${formatLocalDate(addDays(today, -Number(recentDays[1]) - 1))}`;
  if (/이번\s*주/.test(text) || /금주/.test(text)) {
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    return `after:${formatLocalDate(addDays(monday, -1))} before:${formatLocalDate(addDays(monday, 7))}`;
  }
  if (/지난\s*주/.test(text) || /저번\s*주/.test(text)) {
    const thisMonday = addDays(today, -((today.getDay() + 6) % 7));
    const lastMonday = addDays(thisMonday, -7);
    return `after:${formatLocalDate(addDays(lastMonday, -1))} before:${formatLocalDate(thisMonday)}`;
  }
  return "";
}

function removeSlackDateExpressions(text: string): string {
  return text
    .replace(/20\d{2}년(?:\s*\d{1,2}월(?:\s*\d{1,2}일)?)?(?:에|의|동안|으로|부터|도)?/g, " ")
    .replace(/최근\s*\d{1,3}\s*일(?:간|동안)?|오늘|어제|이번\s*주|금주|지난\s*주|저번\s*주/g, " ");
}

export function buildSlackSearchQuery(question: string, messages: ChatMessage[], now = new Date()): string {
  const previousUserQuestions = messages.filter((message) => message.role === "user").slice(-2).reverse().map((message) => message.content);
  const contents = [question, ...previousUserQuestions];
  const dateFilter = contents.map((content) => buildSlackDateFilter(content, now)).find(Boolean) ?? "";
  const tokens: string[] = [];
  for (const content of contents) {
    const matches = removeSlackDateExpressions(content).match(/[A-Za-z가-힣0-9][A-Za-z가-힣0-9_-]*/g) ?? [];
    for (const rawToken of matches) {
      const token = rawToken.replace(/^https?$/i, "");
      const normalized = token.toLocaleLowerCase();
      if (token.length < 2 || slackSearchStopWords.has(normalized) || /^\d+$/.test(token)) continue;
      if (!tokens.some((item) => item.toLocaleLowerCase() === normalized)) tokens.push(token);
      if (tokens.length === 4) break;
    }
    if (tokens.length === 4) break;
  }
  const keywords = tokens.join(" ") || (dateFilter ? "" : question.trim().slice(0, 80));
  return [keywords, dateFilter].filter(Boolean).join(" ");
}

export async function streamAnswerWithOrbitContext(
  question: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
): Promise<StreamAnswer> {
  const slackQuery = buildSlackSearchQuery(question, messages);
  const [settings, context] = await Promise.all([
    getAppSettings(),
    buildOrbitContext(new Date(), callbacks.onSource, slackQuery),
  ]);
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
      requestId,
      model: settings.openai_model || null,
      question,
      context,
      conversation: messages.slice(-12).map((message) => ({ role: message.role, content: message.content })),
      onEvent: channel,
    });
    return { content, responseId, cancelled: cancelled || Boolean(callbacks.signal?.aborted) };
  } finally {
    callbacks.signal?.removeEventListener("abort", cancel);
  }
}
