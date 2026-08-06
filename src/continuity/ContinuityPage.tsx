import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  Archive,
  Check,
  ClipboardList,
  FileSearch,
  Inbox,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { WorkItem } from "../domain/work-item";
import {
  exactExternalLinkAutomationIdentity,
  exactInboxIgnoreAutomationIdentity,
} from "../domain/automation";
import { listWorkItems } from "../data/work-item-repository";
import type { InboxCandidate, SourceSyncState, SyncSource } from "../domain/work-continuity";
import {
  adoptInboxCandidate,
  discoverInboxCandidates,
  ignoreInboxCandidate,
  linkInboxCandidate,
  listInboxCandidatePage,
} from "../data/inbox-repository";
import {
  searchCompletedWorkPage,
  type CompletionEvidence,
  type CompletedWorkSearchResult,
} from "../data/completion-repository";
import {
  calculateContinuityMetrics,
  type ContinuityMetrics,
} from "../data/continuity-metrics-repository";
import { listSourceSyncStates } from "../data/source-sync-repository";
import { listActivityEvents } from "../data/work-continuity-repository";
import {
  generateWeeklyReview,
  listWeeklyReviews,
  type WeeklyReview,
} from "../data/weekly-review-repository";
import {
  adoptTemplateChecklist,
  recommendTaskTemplates,
  rejectTemplateRecommendation,
  saveTaskTemplate,
  listTaskTemplates,
  type TaskTemplate,
  type TaskTemplateRecommendation,
} from "../data/task-template-repository";
import {
  disableAutomationRule,
  enableAutomationRule,
  listAutomationActions,
  listAutomationRules,
  recordAutomationApproval,
  refreshWithEnabledAutomation,
  runEnabledInboxAutomations,
  undoAutomationAction,
  type AutomationAction,
  type AutomationRule,
} from "../data/automation-repository";
import { refreshConnectedSource } from "../sources/connected-source-refresh";
import { listWorkItemLinks } from "../data/work-item-link-repository";
import {
  approveExternalAction,
  beginExternalActionExecution,
  cancelExternalAction,
  createExternalActionRequest,
  finishExternalAction,
  getExternalActionRequest,
  listExternalActionRequests,
  markExternalActionAwaitingApproval,
  prepareExternalActionRetry,
  type ExternalActionRequest,
  type ExternalActionErrorCategory,
} from "../data/external-action-repository";
import {
  executeApprovedJiraTransition,
  previewJiraDoneTransition,
  reconcileJiraTransition,
} from "../sources/jira-transition-adapter";
import {
  executeApprovedJiraOutboxAction,
  jiraPreviewToExternalActionInput,
} from "../sources/jira-outbox-safety";
import { formatRelativeTime, pageRange, presentFreshness, type PageRange } from "./presenters";
import "./ContinuityPage.scss";

export type ContinuityTab = "inbox" | "writeback" | "history" | "review" | "templates" | "automation" | "diagnostics";

const tabs: Array<{ id: ContinuityTab; label: string; icon: typeof Inbox }> = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "writeback", label: "Jira 승인", icon: ShieldCheck },
  { id: "history", label: "완료 기록", icon: FileSearch },
  { id: "review", label: "주간 회고", icon: ClipboardList },
  { id: "templates", label: "템플릿", icon: Archive },
  { id: "automation", label: "자동화", icon: Sparkles },
  { id: "diagnostics", label: "동기화 진단", icon: Activity },
];

const sourceLabel: Record<string, string> = {
  jira: "Jira", github: "GitHub", slack: "Slack", calendar: "Calendar",
  confluence: "Confluence", ai: "AI 세션",
};

export default function ContinuityPage({
  workItems,
  onChanged,
  onOpenTask,
  initialTab = "inbox",
}: {
  workItems: WorkItem[];
  onChanged: () => Promise<void>;
  onOpenTask: (item: WorkItem) => void;
  initialTab?: ContinuityTab;
}) {
  const [tab, setTab] = useState<ContinuityTab>(initialTab);
  const [inbox, setInbox] = useState<InboxCandidate[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [inboxPage, setInboxPage] = useState(1);
  const [history, setHistory] = useState<CompletedWorkSearchResult[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [syncStates, setSyncStates] = useState<SourceSyncState[]>([]);
  const [metrics, setMetrics] = useState<ContinuityMetrics | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [historySource, setHistorySource] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyProject, setHistoryProject] = useState("");
  const [historyState, setHistoryState] = useState("");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60_000);
    try {
      const inboxPromise = (async () => {
        if (tab === "inbox") await discoverInboxCandidates();
        let page = await listInboxCandidatePage("new", {
          limit: INBOX_PAGE_SIZE,
          offset: (inboxPage - 1) * INBOX_PAGE_SIZE,
        });
        if (tab !== "inbox") return { page, automationErrors: [] as string[] };
        const automation = await runEnabledInboxAutomations(page.items);
        if (automation.executed > 0) {
          page = await listInboxCandidatePage("new", {
            limit: INBOX_PAGE_SIZE,
            offset: (inboxPage - 1) * INBOX_PAGE_SIZE,
          });
        }
        return { page, automationErrors: automation.errors };
      })();
      const [inboxResult, nextHistory, nextSync, nextMetrics, events] = await Promise.all([
        inboxPromise,
        searchCompletedWorkPage({
          query,
          source: historySource as CompletionEvidence["source"] || undefined,
          from: historyFrom ? new Date(`${historyFrom}T00:00:00`).toISOString() : undefined,
          to: historyTo ? new Date(`${historyTo}T23:59:59.999`).toISOString() : undefined,
          jiraProjectKey: historyProject || undefined,
          state: historyState as "active" | "superseded" || undefined,
          limit: HISTORY_PAGE_SIZE,
          offset: (historyPage - 1) * HISTORY_PAGE_SIZE,
        }),
        listSourceSyncStates(),
        calculateContinuityMetrics({ start, end }),
        listActivityEvents({ since: start.toISOString(), limit: 500 }),
      ]);
      setInbox(inboxResult.page.items);
      setInboxTotal(inboxResult.page.total);
      setHistory(nextHistory.items);
      setHistoryTotal(nextHistory.total);
      setSyncStates(nextSync);
      setMetrics(nextMetrics);
      setEventCount(events.length);
      if (inboxResult.automationErrors.length) {
        setError(`자동화하지 못한 Inbox 항목이 있습니다. ${inboxResult.automationErrors.join(" · ")}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, [historyFrom, historyPage, historyProject, historySource, historyState, historyTo, inboxPage, query, tab]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { setHistoryPage(1); }, [historyFrom, historyProject, historySource, historyState, historyTo, query]);
  useEffect(() => {
    setInboxPage((current) => pageRange(inboxTotal, current, INBOX_PAGE_SIZE).page);
  }, [inboxTotal]);
  useEffect(() => {
    setHistoryPage((current) => pageRange(historyTotal, current, HISTORY_PAGE_SIZE).page);
  }, [historyTotal]);

  const sourceStates = useMemo(() => {
    const bySource = new Map(syncStates.map((state) => [state.source, state]));
    return (["jira", "github", "slack", "calendar", "confluence", "ai"] satisfies SyncSource[]).map((source) => {
      const raw = bySource.get(source) ?? { source, scopeKey: source === "ai" ? "local" : "global", status: "never", itemCount: 0, errorSummary: null, lastSuccessAt: null };
      return {
        ...presentFreshness(raw),
        scopeKey: raw.scopeKey,
        lastAttemptAt: "lastAttemptAt" in raw ? raw.lastAttemptAt : null,
        lastSuccessAt: raw.lastSuccessAt,
      };
    });
  }, [syncStates]);

  return (
    <main className="continuity-page">
      <header className="continuity-heading">
        <div><span>WORK CONTINUITY</span><h2>업무 흐름</h2><p>놓친 신호를 Task로 정리하고, 완료한 결정과 동기화 상태를 다시 확인합니다.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}><RefreshCw size={13} className={isLoading ? "is-spinning" : ""} /> 새로고침</button>
      </header>

      <nav className="continuity-tabs" aria-label="업무 흐름 보기">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={13} />{label}{id === "inbox" && inboxTotal > 0 && <b>{inboxTotal}</b>}</button>)}
      </nav>

      {error && <div className="continuity-error" role="alert">데이터를 불러오지 못했습니다. <small>{error}</small></div>}
      {tab === "inbox" && <InboxView candidates={inbox} total={inboxTotal} page={inboxPage} onPage={setInboxPage} workItems={workItems} onChanged={async () => { await refresh(); await onChanged(); }} onOpenTask={onOpenTask} />}
      {tab === "writeback" && <JiraWritebackView workItems={workItems} />}
      {tab === "history" && <HistoryView results={history} total={historyTotal} page={historyPage} onPage={setHistoryPage} query={query} source={historySource} from={historyFrom} to={historyTo} project={historyProject} state={historyState} onQuery={setQuery} onSource={setHistorySource} onFrom={setHistoryFrom} onTo={setHistoryTo} onProject={setHistoryProject} onState={setHistoryState} isLoading={isLoading} />}
      {tab === "review" && <WeeklyReviewView />}
      {tab === "templates" && <TemplateView workItems={workItems} />}
      {tab === "automation" && <AutomationView />}
      {tab === "diagnostics" && <DiagnosticsView states={sourceStates} metrics={metrics} eventCount={eventCount} onRefreshed={refresh} />}
    </main>
  );
}

const INBOX_PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 20;
const ACTION_PAGE_SIZE = 15;
const DIAGNOSTIC_PAGE_SIZE = 6;

function PaginationControls({ range, onPage }: { range: PageRange; onPage: (page: number) => void }) {
  if (range.total <= range.pageSize) return null;

  return (
    <nav className="continuity-pagination" aria-label="목록 페이지">
      <span>{range.start + 1}–{range.end} / {range.total}</span>
      <button type="button" disabled={!range.hasPrevious} onClick={() => onPage(range.page - 1)}>이전</button>
      <strong>{range.page} / {range.pageCount}</strong>
      <button type="button" disabled={!range.hasNext} onClick={() => onPage(range.page + 1)}>다음</button>
    </nav>
  );
}

function InboxView({
  candidates,
  total,
  page,
  onPage,
  workItems,
  onChanged,
  onOpenTask,
}: {
  candidates: InboxCandidate[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  workItems: WorkItem[];
  onChanged: () => Promise<void>;
  onOpenTask: (item: WorkItem) => void;
}) {
  const [adopting, setAdopting] = useState<InboxCandidate | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const range = pageRange(total, page, INBOX_PAGE_SIZE);

  async function perform(id: string, action: () => Promise<void>) {
    setPendingId(id);
    setActionError(null);
    try {
      await action();
      await onChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function adoptCandidate(candidate: InboxCandidate) {
    setPendingId(candidate.id);
    setActionError(null);
    try {
      const id = await adoptInboxCandidate(candidate.id, { title, goal, status: "todo" });
      await onChanged();
      const created = (await listWorkItems()).find((item) => item.id === id);
      if (!created) throw new Error("만든 Task를 다시 불러오지 못했습니다. 목록을 새로고침해 확인하세요.");
      setAdopting(null);
      onOpenTask(created);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingId(null);
    }
  }

  if (!total) return <section className="continuity-empty"><Inbox size={25} /><strong>분류할 신호가 없습니다</strong><span>새 Jira 할당, 저장한 Slack 메시지, 연결되지 않은 AI 세션이 여기에 모입니다.</span></section>;

  return (
    <section className="inbox-view" aria-label="통합 Inbox">
      <header><div><h3>새로운 업무 신호</h3><p>확인하기 전에는 Task가 자동으로 만들어지지 않습니다.</p></div><span>{total}개</span></header>
      {actionError && <div className="continuity-error inbox-action-error" role="alert">작업을 처리하지 못했습니다. <small>{actionError}</small></div>}
      <div className="inbox-candidate-list">
        {candidates.map((candidate) => (
          <article key={candidate.id}>
            <div className={`inbox-source source-${candidate.source}`}>{candidate.source === "ai" ? "AI" : candidate.source.slice(0, 1).toUpperCase()}</div>
            <div className="inbox-copy"><span>{sourceLabel[candidate.source] || candidate.source} · {formatRelativeTime(candidate.discoveredAt)}</span><strong>{candidate.title}</strong><p>{candidate.goal || "추가 설명이 없습니다."}</p>{candidate.externalUrl && <button type="button" onClick={() => void openUrl(candidate.externalUrl!)}><Link2 size={11} /> 원문 열기</button>}</div>
            <div className="inbox-actions">
              <button type="button" disabled={pendingId === candidate.id} onClick={() => void perform(candidate.id, async () => {
                await ignoreInboxCandidate(candidate.id);
                await recordAutomationApproval({
                  ruleKind: "exact-inbox-ignore",
                  normalizedSourceIdentity: exactInboxIgnoreAutomationIdentity(candidate),
                  approved: true,
                  confidence: 1,
                });
              })}>무시</button>
              <button type="button" onClick={() => { setActionError(null); setLinkingId(candidate.id); setWorkItemId(""); }}>기존 Task 연결</button>
              <button className="primary-button" type="button" onClick={() => { setActionError(null); setAdopting(candidate); setTitle(candidate.title); setGoal(candidate.goal || ""); }}>새 Task</button>
            </div>
            {linkingId === candidate.id && <div className="inbox-inline-form"><label><span>연결할 Task</span><select value={workItemId} onChange={(event) => setWorkItemId(event.target.value)}><option value="">선택하세요</option>{workItems.filter((item) => item.status !== "done").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button type="button" onClick={() => setLinkingId(null)}><X size={13} /> 취소</button><button className="primary-button" type="button" disabled={!workItemId} onClick={() => void perform(candidate.id, async () => {
              await linkInboxCandidate(candidate.id, workItemId);
              await recordAutomationApproval({
                ruleKind: "exact-external-link",
                normalizedSourceIdentity: exactExternalLinkAutomationIdentity({
                  source: candidate.source,
                  externalKey: candidate.externalKey,
                  workItemId,
                }),
                approved: true,
                confidence: 1,
              });
              setLinkingId(null);
              const selected = workItems.find((item) => item.id === workItemId);
              if (selected) onOpenTask(selected);
            })}><Check size={13} /> 연결</button></div>}
          </article>
        ))}
      </div>
      <PaginationControls range={range} onPage={onPage} />
      {adopting && (
        <div className="inbox-preview-backdrop" onMouseDown={() => setAdopting(null)}>
          <form
            className="inbox-adopt-preview"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void adoptCandidate(adopting);
            }}
          >
            <header>
              <div><span>Task 전환 미리보기</span><h3>{sourceLabel[adopting.source]} 신호를 Task로 만들기</h3></div>
              <button type="button" aria-label="닫기" onClick={() => setAdopting(null)}><X size={15} /></button>
            </header>
            <label>제목<input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
            <label>목표<textarea value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
            <div className="inbox-preview-source"><Link2 size={13} /><span><strong>원문 연결</strong><small>{adopting.externalUrl || adopting.externalKey}</small></span></div>
            <footer>
              <button type="button" onClick={() => setAdopting(null)}>취소</button>
              <button className="primary-button" type="submit" disabled={!title.trim() || pendingId === adopting.id}>승인하고 만들기</button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}

function JiraWritebackView({ workItems }: { workItems: WorkItem[] }) {
  const [targets, setTargets] = useState<Array<{ workItem: WorkItem; issueKey: string }>>([]);
  const [actions, setActions] = useState<ExternalActionRequest[]>([]);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const range = pageRange(actions.length, page, ACTION_PAGE_SIZE);
  const visibleActions = actions.slice(range.start, range.end);

  useEffect(() => {
    setPage((current) => pageRange(actions.length, current, ACTION_PAGE_SIZE).page);
  }, [actions.length]);

  const load = useCallback(async () => {
    const done = workItems.filter((item) => item.status === "done");
    const [nextActions, links] = await Promise.all([
      listExternalActionRequests(undefined, 100),
      Promise.all(done.map(async (workItem) => ({ workItem, links: await listWorkItemLinks(workItem.id) }))),
    ]);
    setActions(nextActions);
    setTargets(links.flatMap(({ workItem, links: itemLinks }) => itemLinks
      .filter((link) => link.kind === "jira" && link.externalId)
      .map((link) => ({ workItem, issueKey: link.externalId! }))));
  }, [workItems]);
  useEffect(() => { void load().catch((cause) => setError(String(cause))); }, [load]);

  async function mutate(key: string, action: () => Promise<unknown>) {
    setPending(key); setError(null);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  }

  async function createPreview() {
    const target = targets.find(({ workItem, issueKey }) => `${workItem.id}:${issueKey}` === selected);
    if (!target) return;
    const preview = await previewJiraDoneTransition(target.issueKey);
    const id = await createExternalActionRequest(jiraPreviewToExternalActionInput(preview, {
      workItemId: target.workItem.id,
      idempotencyKey: `jira:done:${target.workItem.id}:${target.issueKey}:${preview.previewHash}`,
    }));
    const action = await getExternalActionRequest(id);
    if (action?.status === "draft") await markExternalActionAwaitingApproval(id);
  }

  async function approveAndExecute(action: ExternalActionRequest) {
    if (action.status === "awaiting-approval") await approveExternalAction(action.id, action.previewHash);
    await executeApprovedJiraOutboxAction(
      action.id,
      {
        beginExternalActionExecution,
        finishExternalAction: (id, result) => finishExternalAction(id, {
          ...result,
          errorCategory: result.errorCategory ? mapExternalErrorCategory(result.errorCategory) : undefined,
        }),
      },
      { execute: executeApprovedJiraTransition, reconcile: reconcileJiraTransition },
    );
  }

  return (
    <section className="jira-writeback-view">
      <header>
        <div><h3>Jira 상태 전환 승인</h3><p>Orbit 완료는 유지됩니다. 아래에서 정확한 Jira 이슈와 전환 이름을 확인한 뒤에만 Jira에 씁니다.</p></div>
        <span>자동 실행 안 함</span>
      </header>
      {error && <div className="continuity-error" role="alert">{error}</div>}
      <div className="jira-preview-create">
        <label>
          <span>완료 Task · Jira 이슈</span>
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">대상 선택</option>
            {targets.map(({ workItem, issueKey }) => <option key={`${workItem.id}:${issueKey}`} value={`${workItem.id}:${issueKey}`}>{issueKey} · {workItem.title}</option>)}
          </select>
        </label>
        <button className="primary-button" type="button" disabled={!selected || pending === "preview"} onClick={() => void mutate("preview", createPreview)}>
          {pending === "preview" ? "Jira 확인 중…" : "Done 전환 미리보기"}
        </button>
      </div>
      <div className="jira-action-list">
        {visibleActions.map((action) => (
          <article key={action.id} className={`status-${action.status}`}>
            <div className="jira-action-status"><span>{action.status}</span><strong>{action.externalKey}</strong></div>
            <div className="jira-action-copy">
              <strong>{action.observedState.includes("statusName") ? safeJiraStateName(action.observedState) : action.observedState} → {action.transitionName} → {safeJiraStateName(action.targetState)}</strong>
              <span>시도 {action.attemptCount}회 · {formatRelativeTime(action.updatedAt)}</span>
              {action.errorSummary && <p>{action.errorSummary}</p>}
            </div>
            <div className="jira-action-actions">
              {action.status === "awaiting-approval" && <button className="primary-button" type="button" disabled={pending === action.id} onClick={() => void mutate(action.id, () => approveAndExecute(action))}>승인하고 실행</button>}
              {action.status === "approved" && <button className="primary-button" type="button" disabled={pending === action.id} onClick={() => void mutate(action.id, () => approveAndExecute(action))}>실행</button>}
              {["failed", "needs-reconciliation"].includes(action.status) && <button type="button" disabled={pending === action.id} onClick={() => void mutate(action.id, () => prepareExternalActionRetry(action.id))}>다시 미리보기</button>}
              {["draft", "awaiting-approval", "approved", "failed"].includes(action.status) && <button type="button" disabled={pending === action.id} onClick={() => void mutate(action.id, () => cancelExternalAction(action.id))}>취소</button>}
            </div>
          </article>
        ))}
        {!actions.length && <section className="continuity-empty compact"><ShieldCheck size={22} /><strong>승인 대기 중인 Jira 쓰기가 없습니다</strong><span>Jira가 연결된 완료 Task를 선택하면 정확한 Done 전환을 먼저 미리봅니다.</span></section>}
      </div>
      <PaginationControls range={range} onPage={setPage} />
    </section>
  );
}

function safeJiraStateName(value: string) {
  try { const parsed = JSON.parse(value) as { statusName?: string }; return parsed.statusName || "알 수 없음"; }
  catch { return "알 수 없음"; }
}

function mapExternalErrorCategory(value: string): ExternalActionErrorCategory {
  if (["authentication", "authorization"].includes(value)) return "auth";
  if (value === "rate_limited") return "rate-limit";
  if (value === "network") return "network";
  if (value === "unavailable" || value === "invalid_response") return "server";
  if (["invalid_request", "not_found", "stale_approval", "conflict"].includes(value)) return "validation";
  return "unknown-outcome";
}

type HistoryViewProps = {
  results: CompletedWorkSearchResult[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  query: string;
  source: string;
  from: string;
  to: string;
  project: string;
  state: string;
  onQuery: (value: string) => void;
  onSource: (value: string) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onProject: (value: string) => void;
  onState: (value: string) => void;
  isLoading: boolean;
};

function HistoryView({ results, total, page, onPage, query, source, from, to, project, state, onQuery, onSource, onFrom, onTo, onProject, onState, isLoading }: HistoryViewProps) {
  const range = pageRange(total, page, HISTORY_PAGE_SIZE);

  return (
    <section className="history-view">
      <header><div><h3>완료 작업 검색</h3><p>결정, 위험, 회고와 연결 근거를 함께 검색합니다.</p></div><span>{total}개</span></header>
      <div className="history-filters">
        <label className="history-query"><Search size={13} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="작업명, 결정, 시행착오 검색" /></label>
        <input type="date" value={from} onChange={(event) => onFrom(event.target.value)} aria-label="검색 시작일" />
        <input type="date" value={to} onChange={(event) => onTo(event.target.value)} aria-label="검색 종료일" />
        <input value={project} onChange={(event) => onProject(event.target.value)} placeholder="Jira 프로젝트" aria-label="Jira 프로젝트" />
        <select value={source} onChange={(event) => onSource(event.target.value)} aria-label="근거 소스">
          <option value="">모든 근거</option><option value="jira">Jira</option><option value="github_pr">GitHub PR</option><option value="github_commit">GitHub commit</option><option value="slack">Slack</option><option value="ai">AI 세션</option>
        </select>
        <select value={state} onChange={(event) => onState(event.target.value)} aria-label="완료 기록 상태">
          <option value="">모든 기록</option><option value="active">현재 완료</option><option value="superseded">재개 전 기록</option>
        </select>
      </div>
      {isLoading ? <div className="continuity-loading">검색 중…</div> : results.length ? (
        <>
          <div className="history-results">
            {results.map((record) => (
              <article key={record.id}>
                <header>
                  <div><span>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(record.completedAt))}</span><h4>{record.workItemTitle}</h4></div>
                  <em>{record.provenance === "legacy-inferred" ? "이전 기록" : "완료 기록"}</em>
                </header>
                <p>{record.resultSummary}</p>
                <dl>
                  <div><dt>주요 결정</dt><dd>{record.decisions || "기록 없음"}</dd></div>
                  <div><dt>남은 위험</dt><dd>{record.remainingRisk || "없음"}</dd></div>
                  <div><dt>다음에 다르게</dt><dd>{record.retrospective || "기록 없음"}</dd></div>
                </dl>
                {record.evidence.length > 0 && <footer>{record.evidence.map((entry) => <button key={`${entry.source}:${entry.sourceId}`} type="button" disabled={!entry.url} onClick={() => entry.url && void openUrl(entry.url)}><Link2 size={10} />{entry.label}</button>)}</footer>}
              </article>
            ))}
          </div>
          <PaginationControls range={range} onPage={onPage} />
        </>
      ) : <section className="continuity-empty compact"><FileSearch size={23} /><strong>검색 결과가 없습니다</strong><span>조건을 바꾸거나 완료 시트를 먼저 작성해보세요.</span></section>}
    </section>
  );
}

function WeeklyReviewView() {
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [week, setWeek] = useState(() => new Date().toISOString().slice(0, 10));
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = reviews.find(({ id }) => id === selectedId) ?? reviews[0] ?? null;

  const load = useCallback(async () => {
    const next = await listWeeklyReviews();
    setReviews(next);
    setSelectedId((current) => current && next.some(({ id }) => id === current) ? current : next[0]?.id ?? null);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(String(cause))); }, [load]);

  async function generate() {
    setIsGenerating(true); setError(null);
    try { const review = await generateWeeklyReview({ weekContaining: new Date(`${week}T12:00:00`) }); await load(); setSelectedId(review.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setIsGenerating(false); }
  }

  return <section className="review-view"><header><div><h3>주간 회고</h3><p>동일 주간을 다시 생성해도 이전 버전은 보존됩니다.</p></div><div><input type="date" value={week} onChange={(event) => setWeek(event.target.value)} aria-label="회고 주간" /><button className="primary-button" type="button" onClick={() => void generate()} disabled={isGenerating}>{isGenerating ? "생성 중…" : "회고 생성"}</button></div></header>{error && <div className="continuity-error" role="alert">{error}</div>}<div className="review-layout"><aside aria-label="회고 버전">{reviews.map((review) => <button key={review.id} type="button" className={selected?.id === review.id ? "active" : ""} onClick={() => setSelectedId(review.id)}><strong>{new Intl.DateTimeFormat("ko-KR",{ month: "short", day: "numeric" }).format(new Date(review.weekStart))} 주간</strong><span>버전 {review.version} · {formatRelativeTime(review.createdAt)}</span></button>)}{!reviews.length && <p>저장된 회고 없음</p>}</aside>{selected ? <article className="review-document">{selected.partialSources.length > 0 && <div className="review-warning"><AlertBadge />일부 소스가 최신이 아닙니다: {selected.partialSources.join(", ")}</div>}<header><span>{new Intl.DateTimeFormat("ko-KR",{ dateStyle: "medium" }).format(new Date(selected.weekStart))} — {new Intl.DateTimeFormat("ko-KR",{ dateStyle: "medium" }).format(new Date(selected.weekEnd))}</span><h4>주간 업무 회고 <em>v{selected.version}</em></h4></header><div className="review-summary"><Metric label="완료" value={`${selected.snapshot.completed.length}개`} /><Metric label="재개 성공" value={`${selected.snapshot.resumeSuccessCount}개`} /><Metric label="진행 중" value={`${selected.snapshot.ongoing.length}개`} /><Metric label="막힘" value={`${selected.snapshot.blocked.length}개`} /></div><ReviewList title="완료와 결정" items={selected.snapshot.completed.map((item) => ({ title: item.title, detail: item.decisions || item.result }))} empty="이번 주 완료 기록이 없습니다." /><ReviewList title="계속 진행" items={selected.snapshot.ongoing.map((item) => ({ title: item.title, detail: item.status }))} empty="계속 진행 중인 작업이 없습니다." /><ReviewList title="막힘과 재개 조건" items={selected.snapshot.blocked.map((item) => ({ title: item.title, detail: [item.reason,item.resumeCondition].filter(Boolean).join(" → ") || "구조화된 기록 없음" }))} empty="막힌 작업이 없습니다." /><ReviewList title="다음 주 위험" items={selected.snapshot.stale.map((item) => ({ title: item.title, detail: "7일 이상 의미 있는 진전 없음" }))} empty="방치된 작업이 없습니다." /></article> : <section className="continuity-empty compact"><ClipboardList size={22} /><strong>회고를 생성해보세요</strong><span>AI가 없어도 저장된 근거로 결정적인 회고를 만듭니다.</span></section>}</div></section>;
}

function AlertBadge() { return <span aria-hidden="true">!</span>; }
function ReviewList({ title, items, empty }: { title: string; items: Array<{ title: string; detail: string }>; empty: string }) { return <section className="review-list"><h5>{title}</h5>{items.length ? <ul>{items.map((item, index) => <li key={`${item.title}:${index}`}><strong>{item.title}</strong><span>{item.detail}</span></li>)}</ul> : <p>{empty}</p>}</section>; }

function TemplateView({ workItems }: { workItems: WorkItem[] }) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [recommendations, setRecommendations] = useState<TaskTemplateRecommendation[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [checklist, setChecklist] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doneItems = workItems.filter((item) => item.status === "done");
  const openItems = workItems.filter((item) => item.status !== "done" && item.status !== "inbox");

  const load = useCallback(async () => setTemplates(await listTaskTemplates()), []);
  useEffect(() => { void load().catch((cause) => setError(String(cause))); }, [load]);
  useEffect(() => {
    const item = workItems.find(({ id }) => id === sourceId);
    if (!item) return;
    setTitle(`${item.title} 체크리스트`);
    setChecklist([item.checkpoint, item.nextAction, item.doneDefinition].filter(Boolean).join("\n"));
  }, [sourceId, workItems]);

  async function save() {
    setPending(true); setError(null);
    try {
      const source = workItems.find(({ id }) => id === sourceId);
      await saveTaskTemplate({
        title,
        checklist: checklist.split("\n"),
        sourceWorkItemId: sourceId || null,
        jiraProjectKey: source?.source === "jira" ? source.externalId?.split("-")[0] : null,
        sourceSignature: source?.source ?? null,
      });
      await load(); setTitle(""); setChecklist("");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }
  async function recommend() {
    const item = workItems.find(({ id }) => id === targetId);
    if (!item) return;
    setPending(true); setError(null);
    try { setRecommendations(await recommendTaskTemplates({ workItemId: item.id, title: item.title, jiraProjectKey: item.source === "jira" ? item.externalId?.split("-")[0] : null, sourceSignature: item.source })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }

  return <section className="template-view">{error && <div className="continuity-error" role="alert">{error}</div>}<div className="template-columns"><article><header><div><h3>완료 작업에서 저장</h3><p>한 줄에 체크리스트 한 항목을 입력합니다.</p></div></header><label>완료 작업<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">직접 작성</option>{doneItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>템플릿 이름<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>체크리스트<textarea value={checklist} onChange={(event) => setChecklist(event.target.value)} placeholder={"요구사항 확인\n테스트 실행\n완료 근거 연결"} /></label><button className="primary-button" type="button" onClick={() => void save()} disabled={pending || !title.trim() || !checklist.trim()}>템플릿 저장</button></article><article><header><div><h3>비슷한 작업에 추천</h3><p>낮은 신뢰도에서는 추천하지 않습니다.</p></div></header><label>새 작업<select value={targetId} onChange={(event) => { setTargetId(event.target.value); setRecommendations([]); }}><option value="">Task 선택</option>{openItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button type="button" onClick={() => void recommend()} disabled={pending || !targetId}><Search size={12} /> 유사 템플릿 찾기</button><div className="template-recommendations">{recommendations.map((entry) => <article key={entry.template.id}><div><span>신뢰도 {Math.round(entry.confidence * 100)}%</span><strong>{entry.template.title}</strong><p>{entry.reason}</p><ul>{entry.template.checklist.map((label) => <li key={label}>{label}</li>)}</ul></div><footer><button type="button" onClick={() => void rejectTemplateRecommendation({ workItemId: targetId, templateId: entry.template.id, templateVersion: entry.version }).then(() => setRecommendations((current) => current.filter((candidate) => candidate.template.id !== entry.template.id)))}>추천 안 함</button><button className="primary-button" type="button" onClick={() => void adoptTemplateChecklist({ workItemId: targetId, templateId: entry.template.id, templateVersion: entry.version }).then(() => setRecommendations((current) => current.filter((candidate) => candidate.template.id !== entry.template.id)))}>체크리스트 적용</button></footer></article>)}{targetId && !recommendations.length && <p className="template-empty">아직 추천을 찾지 않았거나 신뢰도 기준을 넘는 템플릿이 없습니다.</p>}</div></article></div><section className="saved-templates"><header><h3>저장된 템플릿</h3><span>{templates.length}개</span></header><div>{templates.map((template) => <article key={template.id}><strong>{template.title}</strong><span>{template.checklist.length}개 항목 · {template.adoptionCount}회 채택</span><ol>{template.checklist.slice(0,4).map((label) => <li key={label}>{label}</li>)}</ol></article>)}{!templates.length && <p>저장된 템플릿이 없습니다.</p>}</div></section></section>;
}

const automationLabels: Record<string,string> = { "exact-external-link": "정확한 외부 링크 연결", "exact-inbox-ignore": "완전 중복 Inbox 무시", "prepare-draft": "체크포인트 초안 준비", "refresh-stale-read": "오래된 읽기 소스 갱신" };
function AutomationView() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [actions, setActions] = useState<AutomationAction[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const range = pageRange(actions.length, page, ACTION_PAGE_SIZE);
  const visibleActions = actions.slice(range.start, range.end);
  const load = useCallback(async () => {
    const [nextRules, nextActions] = await Promise.all([listAutomationRules(), listAutomationActions(100)]);
    setRules(nextRules);
    setActions(nextActions);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(String(cause))); }, [load]);
  useEffect(() => {
    setPage((current) => pageRange(actions.length, current, ACTION_PAGE_SIZE).page);
  }, [actions.length]);
  async function mutate(id: string, action: () => Promise<unknown>) { setPending(id); setError(null); try { await action(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setPending(null); } }
  return (
    <section className="automation-view">
      <header>
        <div><ShieldCheck size={17} /><div><h3>신뢰 기반 선택 자동화</h3><p>모든 규칙은 기본적으로 꺼져 있으며, 3회 연속 승인한 정확 일치 작업만 켤 수 있습니다.</p></div></div>
        <span>외부 쓰기·상태 변경 금지</span>
      </header>
      {error && <div className="continuity-error" role="alert">{error}</div>}
      <div className="automation-rules">
        {rules.map((rule) => (
          <article key={rule.id}>
            <div className={`automation-switch ${rule.status === "enabled" ? "enabled" : ""}`} aria-hidden="true"><i /></div>
            <div>
              <span>{rule.status === "enabled" ? "사용 중" : rule.status === "disabled" ? "꺼짐" : "승인 학습 중"}</span>
              <strong>{automationLabels[rule.ruleKind]}</strong>
              <p>{rule.normalizedSourceIdentity}</p>
              <small>연속 승인 {rule.consecutiveApprovals}/3 · 최소 신뢰도 {Math.round(rule.minimumConfidence * 100)}%</small>
            </div>
            <button type="button" disabled={pending === rule.id || (rule.status !== "enabled" && rule.consecutiveApprovals < 3)} onClick={() => void mutate(rule.id, () => rule.status === "enabled" ? disableAutomationRule(rule.id) : enableAutomationRule(rule.id))}>{rule.status === "enabled" ? "끄기" : "켜기"}</button>
          </article>
        ))}
        {!rules.length && <div className="automation-empty"><Sparkles size={20} /><strong>활성화할 규칙이 없습니다</strong><span>같은 제안을 3회 연속 수락하면 여기에서 켤 수 있습니다.</span></div>}
      </div>
      <section className="automation-log">
        <header><h4>최근 자동화 기록</h4><span>{actions.length}개</span></header>
        {visibleActions.map((action) => (
          <article key={action.id}>
            <div>
              <span>{automationLabels[action.ruleKind]} · {formatRelativeTime(action.createdAt)}</span>
              <strong>{action.reason}</strong>
              <small>{action.affectedRecordType}:{action.affectedRecordId} · 신뢰도 {Math.round(action.confidence * 100)}%</small>
            </div>
            {action.state === "executed" && ["exact-external-link", "exact-inbox-ignore"].includes(action.ruleKind) && <button type="button" disabled={pending === action.id} onClick={() => void mutate(action.id, () => undoAutomationAction(action.id))}>실행 취소</button>}
            <em>{action.state}</em>
          </article>
        ))}
        {!actions.length && <p>실행 기록이 없습니다.</p>}
        <PaginationControls range={range} onPage={setPage} />
      </section>
    </section>
  );
}

function DiagnosticsView({ states, metrics, eventCount, onRefreshed }: {
  states: Array<ReturnType<typeof presentFreshness> & {
    scopeKey: string;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
  }>;
  metrics: ContinuityMetrics | null;
  eventCount: number;
  onRefreshed: () => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [queries, setQueries] = useState<Record<string,string>>({});
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const range = pageRange(states.length, page, DIAGNOSTIC_PAGE_SIZE);
  const visibleStates = states.slice(range.start, range.end);

  useEffect(() => {
    setPage((current) => pageRange(states.length, current, DIAGNOSTIC_PAGE_SIZE).page);
  }, [states.length]);

  async function refreshSource(state: (typeof states)[number]) {
    const needsQuery = state.source === "slack" || state.source === "confluence";
    const scopeKey = needsQuery ? (queries[state.source]?.trim() || (state.scopeKey !== "global" ? state.scopeKey : "")) : state.scopeKey;
    if (needsQuery && !scopeKey) { setError(`${sourceLabel[state.source]} 검색 범위를 입력하세요.`); return; }
    setPending(state.source); setError(null);
    try {
      const normalizedSourceIdentity = `${state.source}:${scopeKey}`;
      const automated = await refreshWithEnabledAutomation({
        normalizedSourceIdentity,
        source: state.source as SyncSource,
        scopeKey,
        identityVersion: state.lastSuccessAt || state.lastAttemptAt || "never",
        refresh: () => refreshConnectedSource({ source: state.source as SyncSource, scopeKey, force: true }).then(() => undefined),
      });
      if (!automated) {
        await refreshConnectedSource({ source: state.source as SyncSource, scopeKey, force: true });
        await recordAutomationApproval({
          ruleKind: "refresh-stale-read",
          normalizedSourceIdentity,
          approved: true,
          confidence: 1,
        });
      }
      await onRefreshed();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  }
  return (
    <section className="diagnostics-view">
      <header><div><h3>동기화와 재개 진단</h3><p>캐시를 숨기지 않고 마지막 성공과 오류 상태를 함께 보여줍니다.</p></div><span>최근 7일</span></header>
      {error && <div className="diagnostics-error" role="alert">{error}</div>}
      <div className="diagnostic-metrics">
        <Metric label="체크포인트 저장률" value={metrics ? `${Math.round(metrics.checkpointSaveRate * 100)}%` : "—"} />
        <Metric label="24시간 재개 성공률" value={metrics ? `${Math.round(metrics.resumeSuccessRate24h * 100)}%` : "—"} />
        <Metric label="7일 방치 비율" value={metrics ? `${Math.round(metrics.abandonedOpenRatio7d * 100)}%` : "—"} />
        <Metric label="기록된 활동" value={`${eventCount}개`} />
      </div>
      <div className="source-diagnostics">
        {visibleStates.map((state) => (
          <article key={state.source} className={state.needsAttention ? "needs-attention" : ""}>
            <div className={`freshness-dot status-${state.status}`} />
            <div>
              <strong>{sourceLabel[state.source] || state.source}</strong>
              <span>{state.label} · 마지막 성공 {state.age}</span>
              <small>{state.detail}</small>
              {(state.source === "slack" || state.source === "confluence") && <input value={queries[state.source] ?? (state.scopeKey !== "global" ? state.scopeKey : "")} onChange={(event) => setQueries((current) => ({ ...current, [state.source]: event.target.value }))} placeholder="검색 범위" aria-label={`${sourceLabel[state.source]} 검색 범위`} />}
            </div>
            <button type="button" disabled={pending === state.source} onClick={() => void refreshSource(state)}>
              <RefreshCw size={11} className={pending === state.source ? "is-spinning" : ""} />{pending === state.source ? "수집 중" : "수동 동기화"}
            </button>
          </article>
        ))}
      </div>
      <PaginationControls range={range} onPage={setPage} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
