import type { WorkItem } from "../../../../entities/work-context/model/work-item";

export type ContinuityWorkItem = WorkItem & {
  blockedReason?: string | null;
  resumeCondition?: string | null;
  pausedAt?: string | null;
  lastFocusedAt?: string | null;
  nextReviewAt?: string | null;
  revision?: number;
};

export type ContinuityDashboardModel = {
  resume: ContinuityWorkItem | null;
  blocked: ContinuityWorkItem[];
  forgotten: ContinuityWorkItem[];
};

export type PageRange = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export function pageRange(total: number, requestedPage: number, pageSize: number): PageRange {
  const safeTotal = Math.max(0, Math.floor(total));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(Math.max(1, normalizedPage), pageCount);
  const start = Math.min(safeTotal, (page - 1) * safePageSize);
  const end = Math.min(safeTotal, start + safePageSize);

  return {
    page,
    pageSize: safePageSize,
    pageCount,
    total: safeTotal,
    start,
    end,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}

const forgottenStatuses = new Set(["review", "ai_running", "blocked"]);

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lastContinuityTime(item: ContinuityWorkItem): number {
  return Math.max(
    timestamp(item.pausedAt),
    timestamp(item.lastFocusedAt),
    timestamp(item.updatedAt),
    timestamp(item.createdAt),
  );
}

export function buildContinuityDashboard(
  workItems: WorkItem[],
  now = new Date(),
  forgottenAfterDays = 7,
): ContinuityDashboardModel {
  const items = workItems as ContinuityWorkItem[];
  const nowMs = now.getTime();
  const forgottenBefore = nowMs - forgottenAfterDays * 24 * 60 * 60 * 1_000;
  const active = items.filter((item) => item.status !== "done" && item.status !== "inbox");
  const resumable = active
    .filter((item) => item.status === "focus" || Boolean(item.pausedAt || item.lastFocusedAt || item.checkpoint))
    .sort((left, right) => lastContinuityTime(right) - lastContinuityTime(left));
  const blocked = active
    .filter((item) => item.status === "blocked")
    .filter((item) => !item.nextReviewAt || timestamp(item.nextReviewAt) <= nowMs)
    .sort((left, right) => lastContinuityTime(left) - lastContinuityTime(right));
  const forgotten = active
    .filter((item) => forgottenStatuses.has(item.status))
    .filter((item) => lastContinuityTime(item) < forgottenBefore)
    .filter((item) => item.status !== "blocked" || !item.nextReviewAt || timestamp(item.nextReviewAt) <= nowMs)
    .sort((left, right) => lastContinuityTime(left) - lastContinuityTime(right));

  return { resume: resumable[0] ?? null, blocked, forgotten };
}

export function formatRelativeTime(value: string | null | undefined, now = new Date()): string {
  const valueMs = timestamp(value);
  if (!valueMs) return "기록 없음";
  const minutes = Math.max(0, Math.floor((now.getTime() - valueMs) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function validateInterruption(input: {
  checkpoint: string;
  nextAction: string;
  targetStatus: string;
  blockedReason?: string;
  resumeCondition?: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.checkpoint.trim()) errors.checkpoint = "현재까지 한 일을 입력하세요.";
  if (!input.nextAction.trim()) errors.nextAction = "다시 시작할 첫 행동을 입력하세요.";
  if (input.targetStatus === "blocked") {
    if (!input.blockedReason?.trim()) errors.blockedReason = "막힌 이유를 입력하세요.";
    if (!input.resumeCondition?.trim()) errors.resumeCondition = "재개 조건을 입력하세요.";
  }
  return errors;
}

export function validateCompletion(input: {
  resultSummary: string;
  decisions: string;
  remainingRisks: string;
  retrospective: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.resultSummary.trim()) errors.resultSummary = "완료 결과를 입력하세요.";
  if (!input.decisions.trim()) errors.decisions = "주요 결정을 입력하세요.";
  if (!input.remainingRisks.trim()) errors.remainingRisks = "남은 위험이 없다면 ‘없음’이라고 입력하세요.";
  if (!input.retrospective.trim()) errors.retrospective = "다음에 다르게 할 점을 입력하세요.";
  return errors;
}

export type FreshnessLike = {
  source: string;
  status: string;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  staleAfterAt?: string | null;
  itemCount?: number;
  errorSummary?: string | null;
};

const freshnessLabels: Record<string, string> = {
  never: "연결 필요",
  syncing: "동기화 중",
  fresh: "최신",
  stale: "업데이트 필요",
  partial: "일부 수집",
  failed: "실패",
  auth_required: "인증 필요",
  "auth-required": "인증 필요",
  rate_limited: "잠시 후 재시도",
  "rate-limited": "잠시 후 재시도",
};

export function presentFreshness(state: FreshnessLike, now = new Date()) {
  const status = state.status in freshnessLabels ? state.status : "never";
  return {
    source: state.source,
    status,
    label: freshnessLabels[status],
    age: state.lastSuccessAt ? formatRelativeTime(state.lastSuccessAt, now) : "성공 기록 없음",
    detail: state.errorSummary || `${state.itemCount ?? 0}개 수집`,
    needsAttention: ["stale", "partial", "failed", "auth_required", "auth-required", "rate_limited", "rate-limited", "never"].includes(status),
  };
}

export function includesCompletedSearchText(
  record: { title?: string; resultSummary?: string; decisions?: string; remainingRisks?: string; retrospective?: string; evidence?: Array<{ label?: string; url?: string }> },
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return true;
  const haystack = [
    record.title,
    record.resultSummary,
    record.decisions,
    record.remainingRisks,
    record.retrospective,
    ...(record.evidence ?? []).flatMap((item) => [item.label, item.url]),
  ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
  return haystack.includes(normalized);
}
