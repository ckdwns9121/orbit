import { invoke } from "@tauri-apps/api/core";
import { displaySessionPrompt, displaySessionTitle, projectName, sessionActivity } from "../model/ai-session";
import {
  briefingSummary,
  mergeBriefingEvidence,
  type DailyBriefing,
  type DailyBriefingEvidence,
  type DailyBriefingItem,
  type DailyBriefingSource,
  type DailyBriefingSourceSummary,
} from "../model/daily-briefing";
import { syncLocalAiSessions } from "./ai-session-repository";
import { listCalendarEvents } from "./calendar-event-repository";
import { searchCompletedWorkPage } from "./completion-repository";
import { listDailyPlan } from "./daily-plan-repository";
import {
  getGoogleCalendarConnection,
  shouldAutoSyncGoogleCalendar,
  syncGoogleCalendar,
} from "./google-calendar-repository";
import { listCachedPullRequests, refreshPullRequestsFromSessions } from "./github-pull-request-repository";
import { listCachedJiraIssues, refreshAssignedJiraIssues } from "./jira-issue-repository";
import { getAppSettings } from "./settings-repository";
import { searchSlackMessages } from "./slack-message-repository";
import { listWorkItemLinks } from "./work-item-link-repository";
import { listWorkItems } from "./work-item-repository";

interface LocalGitWork {
  repository: string;
  repoPath: string;
  branch: string;
  changedFileCount: number;
  aheadCount: number;
  recentCommits: Array<{ sha: string; message: string; committedAt: string }>;
}

const sourceLabels: Record<Exclude<DailyBriefingSource, "task">, string> = {
  slack: "Slack",
  jira: "Jira",
  ai_session: "AI 세션",
  calendar: "Calendar",
  github_pr: "GitHub PR",
  local_git: "로컬 Git",
};

export async function collectDailyBriefing(now = new Date()): Promise<DailyBriefing> {
  const notices: string[] = [];
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayKey = localDate(now);

  const [jiraResult, sessions, calendar, pullRequests, slack, workItems, todayPlan, completions] = await Promise.all([
    refreshAssignedJiraIssues().catch(async (cause) => {
      notices.push(`Jira는 저장된 티켓을 사용합니다. (${message(cause)})`);
      return { issues: await listCachedJiraIssues(), truncated: false };
    }),
    syncLocalAiSessions().catch((cause) => {
      notices.push(`AI 세션을 스캔하지 못했습니다. (${message(cause)})`);
      return [];
    }),
    collectCalendar(todayStart, tomorrow, now, notices),
    refreshPullRequestsFromSessions().catch(async (cause) => {
      notices.push(`GitHub PR은 저장된 목록을 사용합니다. (${message(cause)})`);
      return { pullRequests: (await listCachedPullRequests()).map(({ discoveredAt: _, ...item }) => item), repositoriesScanned: 0, repositoriesSucceeded: 0, warnings: [] };
    }),
    collectSlack(now, notices),
    listWorkItems(),
    listDailyPlan(todayKey),
    searchCompletedWorkPage({ from: yesterdayStart.toISOString(), to: todayStart.toISOString(), limit: 50 }),
  ]);

  const cwds = sessions.map((session) => session.cwd).filter((cwd): cwd is string => Boolean(cwd));
  const localGit = await invoke<LocalGitWork[]>("scan_session_git_work", { cwds }).catch((cause) => {
    notices.push(`로컬 Git 작업을 읽지 못했습니다. (${message(cause)})`);
    return [];
  });
  const branchesWithPullRequest = new Set(pullRequests.pullRequests.map((item) => `${item.repository}:${item.headRefName}`));
  const unsubmittedGit = localGit.filter((item) => !branchesWithPullRequest.has(`${item.repository}:${item.branch}`));
  const reportWorkItemIds = new Set([
    ...completions.items.map((item) => item.workItemId),
    ...workItems.filter((item) => item.completedAt && isWithin(item.completedAt, yesterdayStart, todayStart)).map((item) => item.id),
    ...todayPlan.map((entry) => entry.workItemId),
    ...workItems.filter((item) => ["focus", "ai_running", "review"].includes(item.status)).map((item) => item.id),
  ]);
  const jiraUrls = new Map(jiraResult.issues.map((issue) => [issue.key, issue.url]));
  const linksByWorkItem = new Map(await Promise.all([...reportWorkItemIds].map(async (id) => [
    id,
    (await listWorkItemLinks(id)).map<DailyBriefingEvidence>((link) => ({
      source: link.kind === "slack" ? "slack" : link.kind === "jira" ? "jira" : link.kind === "github_pr" ? "github_pr" : "local_git",
      label: link.label,
      detail: `${link.kind.replace("_", " ")} 연결 컨텍스트`,
      url: link.externalUrl || (link.kind === "jira" && link.externalId ? jiraUrls.get(link.externalId) : undefined) || undefined,
    })),
  ] as const)));

  const yesterday: DailyBriefingItem[] = [];
  for (const completion of completions.items) {
    yesterday.push(reportItem(`done:${completion.id}`, completion.workItemTitle, completion.resultSummary || "완료 기록", "task", completion.completedAt,
      [...completion.evidence.map((item) => ({ source: completionSource(item.source), label: item.label, detail: item.excerpt || item.label, url: item.url || undefined })), ...(linksByWorkItem.get(completion.workItemId) || [])]));
  }
  for (const item of workItems.filter((work) => work.completedAt && isWithin(work.completedAt, yesterdayStart, todayStart) && !completions.items.some((completion) => completion.workItemId === work.id))) {
    yesterday.push(reportItem(`done-task:${item.id}`, item.title, item.goal || "완료 처리된 Task", "task", item.completedAt, linksByWorkItem.get(item.id)));
  }
  for (const issue of jiraResult.issues.filter((item) => item.statusCategory === "done" && isWithin(item.updatedAt, yesterdayStart, todayStart)).slice(0, 10)) {
    yesterday.push(reportItem(`done-jira:${issue.key}`, `${issue.key} ${issue.summary}`, `${issue.status} · 어제 갱신된 완료 티켓`, "jira", issue.updatedAt,
      [{ source: "jira", label: issue.key, detail: `${issue.status} · ${issue.summary}`, url: issue.url }]));
  }
  for (const pr of pullRequests.pullRequests.filter((item) => isWithin(item.updatedAt, yesterdayStart, todayStart)).slice(0, 8)) {
    yesterday.push(reportItem(`yesterday-pr:${pr.repository}#${pr.number}`, pr.title, `${pr.repository}#${pr.number} · ${pr.isDraft ? "Draft" : "업데이트"}`, "github_pr", pr.updatedAt,
      [{ source: "github_pr", label: `${pr.repository}#${pr.number}`, detail: pr.title, url: pr.url }]));
  }
  for (const git of localGit) {
    for (const commit of git.recentCommits.filter((item) => isWithin(item.committedAt, yesterdayStart, todayStart)).slice(0, 5)) {
      yesterday.push(reportItem(`commit:${git.repoPath}:${commit.sha}`, commit.message, `${git.repository} · ${git.branch} · ${commit.sha}`, "local_git", commit.committedAt));
    }
  }
  for (const session of sessions.filter((item) => isWithin(item.updatedAt || new Date(item.modifiedAtMs).toISOString(), yesterdayStart, todayStart)).slice(0, 8)) {
    yesterday.push(reportItem(`session-yesterday:${session.provider}:${session.sessionId}`, displaySessionTitle(session),
      `${session.provider} · ${projectName(session.cwd)} · ${displaySessionPrompt(session.lastPrompt) || "AI 작업 기록"}`, "ai_session", session.updatedAt || new Date(session.modifiedAtMs).toISOString()));
  }

  const today: DailyBriefingItem[] = [];
  for (const entry of todayPlan.filter((item) => item.workItem.status !== "done")) {
    today.push(reportItem(`plan:${entry.id}`, entry.workItem.title,
      [entry.workItem.goal, entry.workItem.targetAt ? `${formatTime(entry.workItem.targetAt)} 목표` : null].filter(Boolean).join(" · ") || "오늘 Planner에 등록된 Task", "task", entry.workItem.targetAt, linksByWorkItem.get(entry.workItem.id)));
  }
  for (const event of calendar) {
    today.push(reportItem(`calendar:${event.id}`, event.title,
      `${event.allDay ? "종일" : `${formatTime(event.startAt)}–${formatTime(event.endAt)}`}${event.location ? ` · ${event.location}` : ""}`, "calendar", event.startAt,
      [{ source: "calendar", label: event.title, detail: event.location || "Google Calendar 일정", url: event.externalUrl || undefined }]));
  }
  const plannedIds = new Set(todayPlan.map((entry) => entry.workItemId));
  for (const item of workItems.filter((work) => !plannedIds.has(work.id) && ["focus", "ai_running", "review"].includes(work.status)).slice(0, 10)) {
    today.push(reportItem(`active:${item.id}`, item.title, item.nextAction || item.goal || "현재 진행 중인 Task", "task", item.targetAt, linksByWorkItem.get(item.id)));
  }
  for (const issue of jiraResult.issues.filter((item) => item.statusCategory === "indeterminate" || item.dueDate === todayKey).slice(0, 10)) {
    if (today.some((item) => item.title.includes(issue.key))) continue;
    today.push(reportItem(`jira:${issue.key}`, `${issue.key} ${issue.summary}`, `${issue.status}${issue.dueDate ? ` · 기한 ${issue.dueDate}` : ""}`, "jira", issue.updatedAt,
      [{ source: "jira", label: issue.key, detail: `${issue.status} · ${issue.summary}`, url: issue.url }]));
  }
  for (const pr of pullRequests.pullRequests.filter((item) => item.authoredByViewer).slice(0, 8)) {
    today.push(reportItem(`authored-pr:${pr.repository}#${pr.number}`, pr.title, `${pr.repository}#${pr.number} · ${pr.isDraft ? "Draft 작성 중" : "열린 PR 후속 확인"}`, "github_pr", pr.updatedAt,
      [{ source: "github_pr", label: `${pr.repository}#${pr.number}`, detail: pr.title, url: pr.url }]));
  }

  const attention: DailyBriefingItem[] = [];
  for (const pr of pullRequests.pullRequests.filter((item) => item.reviewRequested).slice(0, 8)) {
    attention.push(reportItem(`review:${pr.repository}#${pr.number}`, `${pr.title} 리뷰`, `${pr.repository}#${pr.number} · 리뷰 요청됨`, "github_pr", pr.updatedAt,
      [{ source: "github_pr", label: `${pr.repository}#${pr.number}`, detail: pr.title, url: pr.url }]));
  }
  for (const git of unsubmittedGit) {
    attention.push(reportItem(`git:${git.repoPath}:${git.branch}`, `${git.repository} 변경사항 정리`,
      `${git.branch || "detached"} · 변경 파일 ${git.changedFileCount}개 · 미푸시 커밋 ${git.aheadCount}개 · 연결된 PR 없음`, "local_git", git.recentCommits[0]?.committedAt));
  }
  for (const slackMessage of slack.slice(0, 12)) {
    attention.push(reportItem(`slack:${slackMessage.id}`, slackTaskTitle(slackMessage.text),
      `#${slackMessage.channelName || "slack"} · ${slackMessage.userName || "알 수 없음"}`, "slack", slackDate(slackMessage.messageTs),
      [{ source: "slack", label: `#${slackMessage.channelName || "slack"}`, detail: slackMessage.text.slice(0, 350), url: slackMessage.permalink }]));
  }
  for (const issue of jiraResult.issues.filter((item) => item.dueDate && item.dueDate < todayKey && item.statusCategory !== "done").slice(0, 8)) {
    attention.push(reportItem(`overdue:${issue.key}`, `${issue.key} ${issue.summary}`, `${issue.status} · 기한 ${issue.dueDate} 경과`, "jira", issue.updatedAt,
      [{ source: "jira", label: issue.key, detail: issue.summary, url: issue.url }]));
  }
  for (const session of sessions.filter((item) => !item.linkedWorkItemId && sessionActivity(item, now.getTime()).needsAttention).slice(0, 6)) {
    attention.push(reportItem(`session:${session.provider}:${session.sessionId}`, displaySessionTitle(session),
      `${session.provider} · ${projectName(session.cwd)} · Task에 연결되지 않은 최근 세션`, "ai_session", session.updatedAt));
  }

  const sections = {
    yesterday: uniqueItems(yesterday).sort(byOccurredAt),
    today: uniqueItems(today).sort(byOccurredAtAscending),
    attention: uniqueItems(attention).sort(byOccurredAt),
  };
  const references = mergeBriefingEvidence([...sections.yesterday, ...sections.today, ...sections.attention].flatMap((item) => item.evidence).filter((item) => Boolean(item.url)));
  const counts = new Map<Exclude<DailyBriefingSource, "task">, number>([
    ["jira", jiraResult.issues.length], ["ai_session", sessions.length], ["calendar", calendar.length],
    ["github_pr", pullRequests.pullRequests.length], ["slack", slack.length], ["local_git", localGit.length],
  ]);

  return {
    generatedAt: new Date().toISOString(),
    yesterday: { items: sections.yesterday, summary: briefingSummary("어제는", sections.yesterday, "어제 완료되거나 갱신된 작업 기록이 없습니다.") },
    today: { items: sections.today, summary: briefingSummary("오늘은", sections.today, "오늘 예정된 일정이나 진행 중인 작업이 없습니다.") },
    attention: { items: sections.attention, summary: briefingSummary("확인이 필요한 항목은", sections.attention, "현재 별도로 확인할 항목은 없습니다.") },
    references,
    notices,
    sources: (Object.keys(sourceLabels) as Array<Exclude<DailyBriefingSource, "task">>).map<DailyBriefingSourceSummary>((source) => ({ source, label: sourceLabels[source], count: counts.get(source) || 0 })),
  };
}

function reportItem(id: string, title: string, detail: string, source: DailyBriefingSource, occurredAt?: string | null, evidence: DailyBriefingEvidence[] = []): DailyBriefingItem {
  return { id, title, detail, source, occurredAt, evidence };
}
function uniqueItems(items: DailyBriefingItem[]) { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function byOccurredAt(left: DailyBriefingItem, right: DailyBriefingItem) { return (right.occurredAt || "").localeCompare(left.occurredAt || ""); }
function byOccurredAtAscending(left: DailyBriefingItem, right: DailyBriefingItem) { return (left.occurredAt || "~").localeCompare(right.occurredAt || "~"); }
function completionSource(source: "jira" | "github_pr" | "github_commit" | "slack" | "ai"): DailyBriefingSource { return source === "ai" ? "ai_session" : source === "github_commit" ? "local_git" : source; }
function startOfDay(date: Date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function isWithin(value: string, start: Date, end: Date) { const time = new Date(value).getTime(); return time >= start.getTime() && time < end.getTime(); }
function slackDate(value: string) { const seconds = Number(value.split(".")[0]); return Number.isFinite(seconds) ? new Date(seconds * 1_000).toISOString() : null; }
function slackTaskTitle(text: string) { return text.replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "Slack 요청 확인"; }
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatTime(value: string) { return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

async function collectSlack(now: Date, notices: string[]) {
  const settings = await getAppSettings();
  if (!settings.slack_user_id && !settings.slack_user_name) return [];
  const identity = settings.slack_user_id ? `<@${settings.slack_user_id}>` : `"${settings.slack_user_name}"`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return searchSlackMessages(`${identity} after:${localDate(yesterday)}`).catch((cause) => {
    notices.push(`Slack 메시지를 검색하지 못했습니다. (${message(cause)})`);
    return [];
  });
}

async function collectCalendar(start: Date, end: Date, now: Date, notices: string[]) {
  try {
    const connection = await getGoogleCalendarConnection();
    if (shouldAutoSyncGoogleCalendar(connection, now.getTime())) await syncGoogleCalendar();
    return await listCalendarEvents(start, end);
  } catch (cause) {
    notices.push(`Calendar는 저장된 일정을 사용합니다. (${message(cause)})`);
    return listCalendarEvents(start, end).catch(() => []);
  }
}
