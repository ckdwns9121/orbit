import { invoke } from "@tauri-apps/api/core";
import {
  autoConnectContextCandidates,
  contextMatchScore,
  sortContextCandidates,
  type ContextCandidate,
  type RankableContextCandidate,
} from "../domain/context-discovery";
import { displaySessionPrompt, displaySessionTitle, projectName } from "../domain/ai-session";
import { linkAiSession, listAiSessions, syncLocalAiSessions } from "./ai-session-repository";
import {
  listCachedJiraIssues,
  listJiraTaskLinks,
  refreshAssignedJiraIssues,
} from "./jira-issue-repository";
import { getAppSettings } from "./settings-repository";
import { searchSlackMessages } from "./slack-message-repository";
import { createSlackMessageLink, createWorkItemLink } from "./work-item-link-repository";

export interface DiscoveryProgress {
  percent: number;
  label: string;
}

export interface ContextDiscoveryResult {
  candidates: ContextCandidate[];
  usedAi: boolean;
  notices: string[];
}

export interface AutoConnectAiResult {
  connected: ContextCandidate[];
  usedAi: boolean;
  notices: string[];
}

interface AiRankedCandidate {
  id: string;
  score: number;
  reason: string;
}

export async function discoverTaskContext(
  taskTitle: string,
  taskDescription: string,
  onProgress: (progress: DiscoveryProgress) => void,
): Promise<ContextDiscoveryResult> {
  const notices: string[] = [];
  const taskContext = [taskTitle, taskDescription].filter(Boolean).join(" ");

  onProgress({ percent: 8, label: "로컬 AI 세션을 확인하고 있어요" });
  const sessions = await syncLocalAiSessions().catch((cause) => {
    notices.push(`AI 세션을 새로 스캔하지 못해 저장된 정보만 사용합니다. (${message(cause)})`);
    return listAiSessions();
  });

  onProgress({ percent: 30, label: "담당 Jira 티켓을 가져오고 있어요" });
  try {
    await refreshAssignedJiraIssues();
  } catch (cause) {
    notices.push(`Jira를 새로 동기화하지 못해 저장된 티켓을 사용합니다. (${message(cause)})`);
  }

  const [issues, jiraLinks] = await Promise.all([listCachedJiraIssues(), listJiraTaskLinks()]);
  const linkedJiraKeys = new Set(jiraLinks.map((link) => link.issueKey));

  onProgress({ percent: 50, label: "관련 Slack 메시지를 찾고 있어요" });
  const slackMessages = await searchSlackMessages(buildSlackDiscoveryQuery(taskContext)).catch((cause) => {
    notices.push(`Slack 메시지를 검색하지 못했습니다. (${message(cause)})`);
    return [];
  });

  onProgress({ percent: 68, label: "수집한 컨텍스트를 정리하고 있어요" });
  const sessionCandidates = buildSessionCandidates(taskContext, sessions);

  const jiraCandidates = sortContextCandidates(taskContext, issues
    .filter((issue) => !linkedJiraKeys.has(issue.key))
    .map<ContextCandidate>((issue) => ({
      id: `jira:${issue.key}`,
      source: "jira",
      title: `${issue.key} · ${issue.summary}`,
      detail: `${issue.projectName} · ${issue.status}${issue.priority ? ` · ${issue.priority}` : ""}`,
      jiraKey: issue.key,
      url: issue.url,
      score: 0,
      reason: "담당 Jira 티켓",
    }))).slice(0, 30);

  const slackCandidates = sortContextCandidates(taskContext, slackMessages.map<ContextCandidate>((slackMessage) => ({
    id: `slack:${slackMessage.id}`,
    source: "slack",
    title: `#${slackMessage.channelName || "slack"} · ${slackMessage.text.slice(0, 240)}`,
    detail: `${slackMessage.userName || "알 수 없음"} · ${formatSlackTimestamp(slackMessage.messageTs)}`,
    slackMessageId: slackMessage.id,
    slackChannelName: slackMessage.channelName,
    slackUserName: slackMessage.userName,
    slackText: slackMessage.text,
    url: slackMessage.permalink,
    score: 0,
    reason: "관련 Slack 메시지",
  }))).slice(0, 20);

  const pool = [...sessionCandidates, ...jiraCandidates, ...slackCandidates];
  if (pool.length === 0) {
    onProgress({ percent: 100, label: "확인할 수 있는 컨텍스트가 없어요" });
    return { candidates: [], usedAi: false, notices };
  }

  onProgress({ percent: 80, label: "AI가 Task와의 관련도를 분석하고 있어요" });
  const settings = await getAppSettings();
  let ranked: AiRankedCandidate[] = [];
  let usedAi = false;
  try {
    ranked = await invoke<AiRankedCandidate[]>("rank_task_context", {
      taskTitle,
      taskDescription: taskDescription.trim() || null,
      model: settings.openai_model?.trim() || "gpt-5.6-luna",
      candidates: pool.map<RankableContextCandidate>(({ id, source, title, detail }) => ({
        id, source, title, detail,
      })),
    });
    usedAi = true;
  } catch (cause) {
    notices.push(`OpenAI 분석을 사용할 수 없어 제목과 최근 활동으로 후보를 찾았습니다. (${message(cause)})`);
  }

  const aiRanking = new Map(ranked.map((candidate) => [candidate.id, candidate]));
  const candidates = pool
    .map((candidate) => {
      const ai = aiRanking.get(candidate.id);
      const localScore = contextMatchScore(taskContext, candidate);
      return {
        ...candidate,
        score: ai?.score ?? localScore,
        reason: ai?.reason || (localScore > 0 ? "Task 제목·설명과 공통된 맥락이 있어요" : candidate.reason),
      };
    })
    .filter((candidate) => candidate.score >= (usedAi ? 35 : 18))
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);

  onProgress({ percent: 100, label: "관련 컨텍스트 탐색을 마쳤어요" });
  return { candidates, usedAi, notices };
}

export async function connectTaskContext(taskId: string, candidates: ContextCandidate[]): Promise<void> {
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const sessions = unique.filter((candidate) => candidate.source === "ai_session");
  const jiraIssues = unique.filter((candidate) => candidate.source === "jira");
  const slackMessages = unique.filter((candidate) => candidate.source === "slack");

  for (const session of sessions) {
    if (session.provider && session.sessionId) {
      await linkAiSession(session.provider, session.sessionId, taskId);
    }
  }
  for (const issue of jiraIssues) {
    if (issue.jiraKey) await createWorkItemLink(taskId, "jira", issue.jiraKey);
  }
  for (const slackMessage of slackMessages) {
    if (slackMessage.slackMessageId && slackMessage.url) {
      await createSlackMessageLink(taskId, {
        id: slackMessage.slackMessageId,
        permalink: slackMessage.url,
        channelName: slackMessage.slackChannelName || "slack",
        userName: slackMessage.slackUserName || "알 수 없음",
        text: slackMessage.slackText || slackMessage.title,
      });
    }
  }
}

export async function autoConnectTaskAiSessions(
  taskId: string,
  taskTitle: string,
  taskDescription = "",
): Promise<AutoConnectAiResult> {
  const notices: string[] = [];
  const sessions = await syncLocalAiSessions().catch((cause) => {
    notices.push(`AI 세션을 새로 스캔하지 못해 저장된 정보만 사용했습니다. (${message(cause)})`);
    return listAiSessions();
  });
  const taskContext = [taskTitle, taskDescription].filter(Boolean).join(" ");
  const pool = buildSessionCandidates(taskContext, sessions);
  if (pool.length === 0) return { connected: [], usedAi: false, notices };

  const settings = await getAppSettings();
  let ranked: AiRankedCandidate[] = [];
  let usedAi = false;
  try {
    ranked = await invoke<AiRankedCandidate[]>("rank_task_context", {
      taskTitle,
      taskDescription: taskDescription.trim() || null,
      model: settings.openai_model?.trim() || "gpt-5.6-luna",
      candidates: pool.map<RankableContextCandidate>(({ id, source, title, detail }) => ({
        id, source, title, detail,
      })),
    });
    usedAi = true;
  } catch (cause) {
    notices.push(`OpenAI 분석을 사용할 수 없어 제목과 최근 활동으로 판단했습니다. (${message(cause)})`);
  }

  const aiRanking = new Map(ranked.map((candidate) => [candidate.id, candidate]));
  const candidates = pool.map((candidate) => {
    const ai = aiRanking.get(candidate.id);
    const localScore = contextMatchScore(taskContext, candidate);
    return {
      ...candidate,
      score: ai?.score ?? localScore,
      reason: ai?.reason || "Task 제목과 세션 활동의 공통 맥락",
    };
  });
  const connected = autoConnectContextCandidates(candidates);
  await connectTaskContext(taskId, connected);
  return { connected, usedAi, notices };
}

function buildSessionCandidates(
  taskTitle: string,
  sessions: Awaited<ReturnType<typeof listAiSessions>>,
): ContextCandidate[] {
  return sortContextCandidates(taskTitle, sessions
    .filter((session) => !session.linkedWorkItemId)
    .map<ContextCandidate>((session) => ({
      id: `ai:${session.provider}:${session.sessionId}`,
      source: "ai_session",
      title: displaySessionTitle(session),
      detail: [
        projectName(session.cwd),
        displaySessionPrompt(session.firstPrompt),
        displaySessionPrompt(session.lastPrompt),
      ].filter(Boolean).join(" · "),
      provider: session.provider,
      sessionId: session.sessionId,
      score: 0,
      reason: "최근 AI 세션",
    }))).slice(0, 30);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function buildSlackDiscoveryQuery(taskContext: string): string {
  const issueKey = taskContext.match(/[A-Z][A-Z0-9]+-\d+/i)?.[0];
  const tokens = taskContext
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 6);
  return [...new Set([issueKey, ...tokens].filter((value): value is string => Boolean(value)))].join(" ").slice(0, 160);
}

function formatSlackTimestamp(value: string): string {
  const timestamp = Number(value.split(".")[0]) * 1_000;
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
