import type { AiProvider } from "./ai-session";

export type ContextCandidateSource = "ai_session" | "jira" | "slack";

export interface ContextCandidate {
  id: string;
  source: ContextCandidateSource;
  title: string;
  detail: string;
  score: number;
  reason: string;
  provider?: AiProvider;
  sessionId?: string;
  jiraKey?: string;
  slackMessageId?: string;
  slackChannelName?: string;
  slackUserName?: string;
  slackText?: string;
  url?: string;
}

export interface RankableContextCandidate {
  id: string;
  source: ContextCandidateSource;
  title: string;
  detail: string;
}

export function contextMatchScore(taskTitle: string, candidate: RankableContextCandidate): number {
  const task = normalize(taskTitle);
  const target = normalize(`${candidate.title} ${candidate.detail}`);
  if (!task || !target) return 0;

  const taskTokens = tokens(task);
  const targetTokens = new Set(tokens(target));
  const overlap = taskTokens.filter((token) => targetTokens.has(token));
  const exactKey = taskTitle.match(/[a-z][a-z0-9]+-\d+/i)?.[0]?.toLocaleLowerCase();

  let score = overlap.length * 18;
  if (target.includes(task) || task.includes(normalize(candidate.title))) score += 36;
  if (exactKey && `${candidate.title} ${candidate.detail}`.toLocaleLowerCase().includes(exactKey)) score += 55;
  return Math.min(100, score);
}

export function sortContextCandidates<T extends RankableContextCandidate>(
  taskTitle: string,
  candidates: T[],
): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: contextMatchScore(taskTitle, candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ candidate }) => candidate);
}

export function recommendedContextCandidateIds(
  candidates: ContextCandidate[],
  threshold = 60,
): Set<string> {
  return new Set(candidates
    .filter((candidate) => candidate.score >= threshold)
    .map((candidate) => candidate.id));
}

export function autoConnectContextCandidates(
  candidates: ContextCandidate[],
  threshold = 65,
  limit = 3,
): ContextCandidate[] {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const topScore = sorted[0]?.score ?? 0;
  return sorted
    .filter((candidate) => candidate.score >= threshold && candidate.score >= topScore - 15)
    .slice(0, limit);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter((token) => token.length >= 2))];
}
