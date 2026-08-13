import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  MoreHorizontal,
  RefreshCw,
  Search,
  TicketCheck,
  X,
} from "lucide-react";
import type { WorkItem } from "../../entities/work-context/model/work-item";
import { jiraProgressStage, type JiraIssue, type JiraProgressStage, type JiraTaskLink } from "../../entities/work-context/model/jira-issue";
import { listCachedJiraIssues, listJiraTaskLinks, refreshAssignedJiraIssues } from "../../entities/work-context/api/jira-issue-repository";
import { createWorkItemLink } from "../../entities/work-context/api/work-item-link-repository";
import { listAiSessions } from "../../entities/work-context/api/ai-session-repository";
import { getCachedJiraIssueDevelopment, syncJiraIssueDevelopment } from "../../entities/work-context/api/jira-development-repository";
import type { JiraIssueDevelopment } from "../../entities/work-context/model/jira-development";
import "./JiraTicketsPage.scss";

type Filter = "all" | JiraProgressStage | "linked";
const ROW_HEIGHT = 94;
const OVERSCAN = 5;

export default function JiraTicketsPage({ workItems }: { workItems: WorkItem[] }) {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [links, setLinks] = useState<JiraTaskLink[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [development, setDevelopment] = useState<JiraIssueDevelopment | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");

  const loadCache = useCallback(async () => {
    const [cached, nextLinks] = await Promise.all([listCachedJiraIssues(), listJiraTaskLinks()]);
    setIssues(cached);
    setLinks(nextLinks);
    setSelectedKey((current) => current && cached.some((issue) => issue.key === current) ? current : cached[0]?.key || null);
    return cached;
  }, []);

  const refresh = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshAssignedJiraIssues({ force: true });
      await loadCache();
      if (result.truncated) setNotice("최근 변경된 담당 티켓 500개까지만 표시합니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSyncing(false);
    }
  }, [loadCache]);

  useEffect(() => {
    let active = true;
    void loadCache()
      .then(() => { if (active) void refreshAssignedJiraIssues().then(loadCache).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [loadCache]);

  const linkByKey = useMemo(() => new Map(links.map((link) => [link.issueKey, link])), [links]);
  const progressCounts = useMemo(() => {
    const counts: Record<JiraProgressStage, number> = { todo: 0, in_progress: 0, done: 0 };
    issues.forEach((issue) => { counts[jiraProgressStage(issue.statusCategory)] += 1; });
    return counts;
  }, [issues]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return issues.filter((issue) => {
      if (["todo", "in_progress", "done"].includes(filter) && jiraProgressStage(issue.statusCategory) !== filter) return false;
      if (filter === "linked" && !linkByKey.has(issue.key)) return false;
      return !keyword || `${issue.key} ${issue.summary} ${issue.projectName} ${issue.status}`.toLocaleLowerCase().includes(keyword);
    });
  }, [filter, issues, linkByKey, query]);

  const selected = filtered.find((issue) => issue.key === selectedKey) || filtered[0] || null;
  const selectedLink = selected ? linkByKey.get(selected.key) : undefined;
  const openWorkItems = workItems.filter((item) => item.status !== "done");
  const filteredWorkItems = useMemo(() => {
    const keyword = taskQuery.trim().toLocaleLowerCase();
    return keyword ? openWorkItems.filter((item) => item.title.toLocaleLowerCase().includes(keyword)) : openWorkItems;
  }, [openWorkItems, taskQuery]);

  useEffect(() => {
    let active = true;
    setDevelopment(null);
    setIsTaskPickerOpen(false);
    setTaskQuery("");
    if (!selected) return () => { active = false; };
    void getCachedJiraIssueDevelopment(selected.key).then((cached) => {
      if (active) setDevelopment(cached?.development || null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selected?.key]);

  async function connectToTask(workItemId: string) {
    if (!selected || !workItemId) return;
    setConnectingKey(selected.key);
    setError(null);
    try {
      const linkId = await createWorkItemLink(workItemId, "jira", selected.key);
      const sessions = await listAiSessions();
      const cwds = sessions.filter((session) => session.linkedWorkItemId === workItemId && session.cwd).map((session) => session.cwd as string);
      const nextDevelopment = await syncJiraIssueDevelopment(workItemId, linkId, selected.key, cwds);
      setDevelopment(nextDevelopment);
      setLinks(await listJiraTaskLinks());
      setIsTaskPickerOpen(false);
      setTaskQuery("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnectingKey(null);
    }
  }

  return (
    <section className="jira-page">
      <div className="jira-overview" aria-label="Jira 티켓 진행 현황">
        <OverviewCard kind="assigned" label="내 담당 티켓" value={issues.length} description="Jira에서 나에게 할당된 티켓" icon={TicketCheck} active={filter === "all"} onClick={() => setFilter("all")} />
        <OverviewCard kind="in-progress" label="진행 중" value={progressCounts.in_progress} description="현재 처리하고 있는 티켓" icon={Clock3} active={filter === "in_progress"} onClick={() => setFilter("in_progress")} />
        <OverviewCard kind="done" label="완료" value={progressCounts.done} description="완료된 담당 티켓" icon={CheckCircle2} active={filter === "done"} onClick={() => setFilter("done")} />
      </div>

      {error && <div className="jira-message error" role="alert">{error}</div>}
      {notice && <div className="jira-message">{notice}</div>}

      <div className="jira-content">
        <div className="jira-list-panel">
          <div className="jira-toolbar">
            <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="티켓 검색" aria-label="Jira 티켓 검색" /></label>
            <div className="jira-filter-menu">
              <button type="button" onClick={() => setIsFilterOpen((value) => !value)} aria-expanded={isFilterOpen}>{filterLabel(filter)}<ChevronDown size={13} /></button>
              {isFilterOpen && <div className="jira-filter-popover">
                {(["all", "todo", "in_progress", "done", "linked"] as const).map((value) => (
                  <button className={filter === value ? "active" : ""} type="button" key={value} onClick={() => { setFilter(value); setIsFilterOpen(false); }}>{filterLabel(value)}<span>{filterCount(value, issues, linkByKey)}</span></button>
                ))}
              </div>}
            </div>
            <button className="jira-refresh" type="button" onClick={() => void refresh()} disabled={isSyncing} aria-label="Jira 티켓 새로고침"><RefreshCw size={15} className={isSyncing ? "is-spinning" : ""} /></button>
          </div>
          <div className="jira-list" aria-label="내 담당 Jira 티켓">
            {isLoading ? <div className="jira-empty">캐시를 불러오는 중…</div> : filtered.length === 0 ? (
              <div className="jira-empty"><strong>표시할 담당 티켓이 없습니다</strong><span>Jira에서 나에게 할당된 티켓을 자동으로 확인합니다.</span></div>
            ) : <VirtualJiraList issues={filtered} selectedKey={selected?.key || null} linkByKey={linkByKey} onSelect={setSelectedKey} resetKey={`${filter}:${query}`} />}
          </div>
          <footer><span>{filtered.length ? `1–${Math.min(filtered.length, 50)}` : "0"} / {filtered.length}</span><span>{isSyncing ? "Jira 동기화 중…" : "최근 변경순"}</span></footer>
        </div>

        <aside className="jira-detail">
          {selected ? <>
            <div className="jira-detail-heading">
              <div><span>{selected.key}</span><h2>{selected.summary}</h2><p>{selected.projectName}</p></div>
              <button type="button" onClick={() => void openUrl(selected.url)} aria-label="Jira에서 열기"><MoreHorizontal size={18} /></button>
            </div>
            <div className="jira-detail-badges"><StatusBadge issue={selected} /><span>{selected.priority || "우선순위 없음"}</span>{selected.dueDate && <span>마감 {selected.dueDate}</span>}</div>

            <section className="jira-detail-card jira-description-card">
              <div className="jira-card-heading"><strong>티켓 정보</strong><span>{formatRelativeDate(selected.updatedAt)} 변경</span></div>
              <p>{selected.projectName} 프로젝트의 {selected.status} 상태 티켓입니다. 상세 설명과 댓글은 Jira 원문에서 확인할 수 있습니다.</p>
              <button type="button" onClick={() => void openUrl(selected.url)}>Jira 원문 보기 <ArrowUpRight size={13} /></button>
            </section>

            <section className="jira-detail-card jira-development-card">
              <div className="jira-card-heading"><strong>Development</strong><span>{development ? "GitHub 연결 정보" : "Task 연결 후 자동 수집"}</span></div>
              <DevelopmentRow icon={GitBranch} label="브랜치" count={development?.branches.length || 0} />
              <DevelopmentRow icon={GitCommitHorizontal} label="커밋" count={development?.commits.length || 0} />
              <DevelopmentRow icon={GitPullRequest} label="Pull request" count={development?.pullRequests.length || 0} />
            </section>

            <div className="jira-task-link">
              <div className="jira-card-heading"><strong>Orbit Task</strong><span>{selectedLink ? "연결됨" : "연결 필요"}</span></div>
              {selectedLink ? <div className="jira-linked-task"><Link2 size={15} /><span><strong>{selectedLink.workItemTitle}</strong><small>Jira·PR·커밋 컨텍스트를 함께 관리합니다.</small></span></div> : (
                <button className="jira-task-connect" type="button" onClick={() => setIsTaskPickerOpen(true)} disabled={connectingKey === selected.key}><Link2 size={15} />{connectingKey === selected.key ? "연결 중…" : "Orbit Task에 연결"}</button>
              )}
              {isTaskPickerOpen && <div className="jira-task-picker">
                <div><strong>연결할 Task 선택</strong><button type="button" onClick={() => setIsTaskPickerOpen(false)} aria-label="닫기"><X size={15} /></button></div>
                <label><Search size={14} /><input autoFocus value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Task 검색" /></label>
                <div className="jira-task-options">{filteredWorkItems.slice(0, 8).map((item) => <button type="button" key={item.id} onClick={() => void connectToTask(item.id)}><CircleDot size={11} /><span>{item.title}</span></button>)}{filteredWorkItems.length === 0 && <span>검색 결과가 없습니다.</span>}</div>
              </div>}
            </div>
          </> : <div className="jira-empty">티켓을 선택하세요.</div>}
        </aside>
      </div>
    </section>
  );
}

function OverviewCard({ kind, label, value, description, icon: Icon, active, onClick }: { kind: string; label: string; value: number; description: string; icon: ComponentType<{ size?: number }>; active: boolean; onClick: () => void }) {
  return <button className={`jira-overview-card ${kind} ${active ? "active" : ""}`} type="button" onClick={onClick}><span className="jira-overview-icon"><Icon size={18} /></span><span><small>{label}</small><strong>{value}</strong><em>{description}</em></span></button>;
}

const JiraRow = memo(function JiraRow({ issue, linkedTask, selected, onSelect }: { issue: JiraIssue; linkedTask?: JiraTaskLink; selected: boolean; onSelect: (key: string) => void }) {
  return <button className={`jira-row ${selected ? "selected" : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(issue.key)}>
    <span className={`jira-row-dot ${jiraProgressStage(issue.statusCategory)}`} />
    <span className="jira-row-copy"><small>{issue.key} · {issue.projectName}</small><strong>{issue.summary}</strong>{linkedTask && <em><Link2 size={10} />{linkedTask.workItemTitle}</em>}</span>
    <span className="jira-row-state"><StatusBadge issue={issue} /><ChevronRight size={16} /></span>
  </button>;
});

const VirtualJiraList = memo(function VirtualJiraList({ issues, selectedKey, linkByKey, onSelect, resetKey }: { issues: JiraIssue[]; selectedKey: string | null; linkByKey: Map<string, JiraTaskLink>; onSelect: (key: string) => void; resetKey: string }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (element) element.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(issues.length, start + visibleCount + OVERSCAN * 2);
  return <div className="virtual-jira-viewport" ref={viewportRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div className="virtual-jira-space" style={{ height: issues.length * ROW_HEIGHT }}><div className="virtual-jira-window" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>{issues.slice(start, end).map((issue) => <JiraRow key={issue.key} issue={issue} linkedTask={linkByKey.get(issue.key)} selected={selectedKey === issue.key} onSelect={onSelect} />)}</div></div></div>;
});

function StatusBadge({ issue }: { issue: JiraIssue }) { return <span className={`jira-status ${issue.statusCategory}`}><i />{issue.status}</span>; }
function DevelopmentRow({ icon: Icon, label, count }: { icon: ComponentType<{ size?: number }>; label: string; count: number }) { return <div className="jira-development-row"><Icon size={14} /><span>{label}</span><strong>{count}</strong><ChevronRight size={14} /></div>; }
function filterLabel(filter: Filter) { return ({ all: "전체", todo: "해야 할 일", in_progress: "진행 중", done: "완료", linked: "Task 연결됨" } as Record<Filter, string>)[filter]; }
function filterCount(filter: Filter, issues: JiraIssue[], links: Map<string, JiraTaskLink>) { if (filter === "all") return issues.length; if (filter === "linked") return issues.filter((issue) => links.has(issue.key)).length; return issues.filter((issue) => jiraProgressStage(issue.statusCategory) === filter).length; }
function formatRelativeDate(value: string): string { const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) return value; const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000)); if (minutes < 60) return `${minutes}분 전`; if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`; if (minutes < 43_200) return `${Math.floor(minutes / 1_440)}일 전`; return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(timestamp); }
