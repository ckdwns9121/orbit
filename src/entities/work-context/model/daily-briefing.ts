export type DailyBriefingSource = "slack" | "jira" | "ai_session" | "calendar" | "github_pr" | "local_git" | "task";

export interface DailyBriefingEvidence {
  source: DailyBriefingSource;
  label: string;
  detail: string;
  url?: string;
}

export interface DailyBriefingItem {
  id: string;
  title: string;
  detail: string;
  source: DailyBriefingSource;
  occurredAt?: string | null;
  evidence: DailyBriefingEvidence[];
}

export interface DailyBriefingSection {
  summary: string;
  items: DailyBriefingItem[];
}

export interface DailyBriefingSourceSummary {
  source: Exclude<DailyBriefingSource, "task">;
  label: string;
  count: number;
}

export interface DailyBriefing {
  generatedAt: string;
  yesterday: DailyBriefingSection;
  today: DailyBriefingSection;
  attention: DailyBriefingSection;
  references: DailyBriefingEvidence[];
  sources: DailyBriefingSourceSummary[];
  notices: string[];
}

export function mergeBriefingEvidence(evidence: DailyBriefingEvidence[], limit = 30) {
  return [...new Map(evidence.map((item) => [`${item.source}:${item.url || item.label}`, item])).values()].slice(0, limit);
}

export function briefingSummary(label: string, items: DailyBriefingItem[], empty: string) {
  if (!items.length) return empty;
  const preview = items.slice(0, 2).map((item) => item.title).join(", ");
  const rest = items.length > 2 ? ` 외 ${items.length - 2}건` : "";
  return `${label} ${preview}${rest}입니다.`;
}
