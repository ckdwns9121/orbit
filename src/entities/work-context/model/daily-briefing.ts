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
  markdown: string;
}

export function dailyBriefingToMarkdown(report: Omit<DailyBriefing, "markdown">) {
  const lines = [
    `# 오늘의 업무 브리핑 — ${markdownDate(report.generatedAt)}`,
    "",
    `> 생성 시각: ${markdownDateTime(report.generatedAt)}  `,
    "> Slack · Jira · AI 세션 · Google Calendar · GitHub · 로컬 Git 기반 읽기 전용 리포트",
    "",
    ...markdownSection("어제 한 일", report.yesterday),
    ...markdownSection("오늘 예정", report.today),
    ...markdownSection("확인 필요", report.attention),
    "## 참고 링크",
    "",
    ...(report.references.length
      ? report.references.map((reference) => `- [${escapeMarkdown(reference.label)}](${reference.url}) — ${singleLine(reference.detail)}`)
      : ["- 연결된 참고 링크가 없습니다."]),
  ];
  if (report.notices.length) lines.push("", "## 수집 안내", "", ...report.notices.map((notice) => `- ${singleLine(notice)}`));
  return `${lines.join("\n")}\n`;
}

function markdownSection(title: string, section: DailyBriefingSection) {
  return [
    `## ${title}`,
    "",
    section.summary,
    "",
    ...(section.items.length ? section.items.map((item) => {
      const time = item.occurredAt ? ` (${markdownTime(item.occurredAt)})` : "";
      return `- **${escapeMarkdown(item.title)}**${time}\n  - ${singleLine(item.detail)}`;
    }) : ["- 기록된 항목이 없습니다."]),
    "",
  ];
}

function escapeMarkdown(value: string) { return value.replace(/([\\`*_{}\[\]#+.!|])/g, "\\$1"); }
function singleLine(value: string) { return value.replace(/\s+/g, " ").trim(); }
function markdownTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "시간 미상" : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date); }
function markdownDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(value)); }
function markdownDateTime(value: string) { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function mergeBriefingEvidence(evidence: DailyBriefingEvidence[], limit = 30) {
  return [...new Map(evidence.map((item) => [`${item.source}:${item.url || item.label}`, item])).values()].slice(0, limit);
}

export function briefingSummary(label: string, items: DailyBriefingItem[], empty: string) {
  if (!items.length) return empty;
  const preview = items.slice(0, 2).map((item) => item.title).join(", ");
  const rest = items.length > 2 ? ` 외 ${items.length - 2}건` : "";
  return `${label} ${preview}${rest}입니다.`;
}
