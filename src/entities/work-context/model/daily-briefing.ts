export type DailyBriefingSource = "slack" | "jira" | "ai_session" | "calendar" | "github_pr" | "local_git";

export interface DailyBriefingEvidence {
  source: DailyBriefingSource;
  externalId?: string;
  label: string;
  detail: string;
  url?: string;
}

export interface DailyBriefingCandidate {
  id: string;
  title: string;
  description: string;
  priority: "p1" | "p2" | "p3";
  targetAt: string | null;
  score: number;
  reason: string;
  evidence: DailyBriefingEvidence[];
}

export interface DailyBriefingSourceSummary {
  source: DailyBriefingSource;
  label: string;
  count: number;
  notice?: string;
}

export interface DailyBriefing {
  generatedAt: string;
  candidates: DailyBriefingCandidate[];
  sources: DailyBriefingSourceSummary[];
  notices: string[];
  usedAi: boolean;
}

export function briefingPriorityForScore(score: number): DailyBriefingCandidate["priority"] {
  if (score >= 80) return "p1";
  if (score >= 55) return "p2";
  return "p3";
}

export function mergeBriefingEvidence(evidence: DailyBriefingEvidence[], limit = 4) {
  return [...new Map(evidence.map((item) => [`${item.source}:${item.url || item.label}`, item])).values()].slice(0, limit);
}
