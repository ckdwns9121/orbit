import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorkItem } from "../../entities/work-context/model/work-item";
import {
  jiraProgressStage,
  type JiraIssue,
  type JiraProgressStage,
  type JiraTaskLink,
} from "../../entities/work-context/model/jira-issue";
import {
  listCachedJiraIssues,
  listJiraTaskLinks,
  refreshAssignedJiraIssues,
} from "../../entities/work-context/api/jira-issue-repository";
import { createWorkItemLink } from "../../entities/work-context/api/work-item-link-repository";
import { listAiSessions } from "../../entities/work-context/api/ai-session-repository";
import { syncJiraIssueDevelopment } from "../../entities/work-context/api/jira-development-repository";
import "./JiraTicketsPage.scss";

type Filter = "all" | JiraProgressStage | "linked";
const ROW_HEIGHT = 82;
const OVERSCAN = 5;
const progressCards: Array<{ stage: JiraProgressStage; label: string }> = [
  { stage: "todo", label: "해야 할 일" },
  { stage: "in_progress", label: "진행 중" },
  { stage: "done", label: "완료" },
];

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

  const loadCache = useCallback(async () => {
    const [cached, nextLinks] = await Promise.all([listCachedJiraIssues(), listJiraTaskLinks()]);
    setIssues(cached);
    setLinks(nextLinks);
    setSelectedKey((current) => current && cached.some((issue) => issue.key === current)
      ? current
      : cached[0]?.key || null);
    return cached;
  }, []);

  const refresh = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshAssignedJiraIssues();
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
      .then(() => { if (active) void refresh(); })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [loadCache, refresh]);

  const linkByKey = useMemo(() => new Map(links.map((link) => [link.issueKey, link])), [links]);
  const progressCounts = useMemo(() => {
    const counts: Record<JiraProgressStage, number> = { todo: 0, in_progress: 0, done: 0 };
    issues.forEach((issue) => { counts[jiraProgressStage(issue.statusCategory)] += 1; });
    return counts;
  }, [issues]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return issues.filter((issue) => {
      if (filter === "todo" || filter === "in_progress" || filter === "done") {
        if (jiraProgressStage(issue.statusCategory) !== filter) return false;
      }
      if (filter === "linked" && !linkByKey.has(issue.key)) return false;
      return !keyword || `${issue.key} ${issue.summary} ${issue.projectName} ${issue.status}`.toLocaleLowerCase().includes(keyword);
    });
  }, [filter, issues, linkByKey, query]);

  const selected = filtered.find((issue) => issue.key === selectedKey) || filtered[0] || null;
  const selectedLink = selected ? linkByKey.get(selected.key) : undefined;
  const openWorkItems = workItems.filter((item) => item.status !== "done");

  async function connectToTask(workItemId: string) {
    if (!selected || !workItemId) return;
    setConnectingKey(selected.key);
    setError(null);
    try {
      const linkId = await createWorkItemLink(workItemId, "jira", selected.key);
      const sessions = await listAiSessions();
      const cwds = sessions
        .filter((session) => session.linkedWorkItemId === workItemId && session.cwd)
        .map((session) => session.cwd as string);
      await syncJiraIssueDevelopment(workItemId, linkId, selected.key, cwds);
      setLinks(await listJiraTaskLinks());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnectingKey(null);
    }
  }

  return (
    <section className="jira-page">
      <div className="jira-overview" aria-label="Jira 티켓 진행 현황">
        {progressCards.map(({ stage, label }) => (
          <button
            className={`jira-overview-card ${stage} ${filter === stage ? "active" : ""}`}
            type="button"
            aria-pressed={filter === stage}
            onClick={() => setFilter(stage)}
            key={stage}
          >
            <span><i aria-hidden="true" />{label}</span>
            <strong>{progressCounts[stage]}</strong>
            <small>전체 {issues.length}개 중 {issues.length ? Math.round((progressCounts[stage] / issues.length) * 100) : 0}%</small>
          </button>
        ))}
      </div>

      <div className="jira-toolbar">
        <div className="jira-filters">
          <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>전체</button>
          <button className={filter === "todo" ? "active" : ""} type="button" onClick={() => setFilter("todo")}>해야 할 일</button>
          <button className={filter === "in_progress" ? "active" : ""} type="button" onClick={() => setFilter("in_progress")}>진행 중</button>
          <button className={filter === "done" ? "active" : ""} type="button" onClick={() => setFilter("done")}>완료</button>
          <button className={filter === "linked" ? "active" : ""} type="button" onClick={() => setFilter("linked")}>Task 연결됨</button>
          <span className="jira-sync-state">{isSyncing ? "Jira 동기화 중…" : `담당 티켓 ${issues.length}개`}</span>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="티켓, 프로젝트, 상태 검색" aria-label="Jira 티켓 검색" />
      </div>

      {error && <div className="jira-message error">{error}</div>}
      {notice && <div className="jira-message">{notice}</div>}

      <div className="jira-content">
        <div className="jira-list" aria-label="내 담당 Jira 티켓">
          {isLoading ? (
            <div className="jira-empty">캐시를 불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div className="jira-empty"><strong>표시할 담당 티켓이 없습니다</strong><span>Jira에서 나에게 할당된 티켓을 자동으로 확인합니다.</span></div>
          ) : (
            <VirtualJiraList
              issues={filtered}
              selectedKey={selected?.key || null}
              linkByKey={linkByKey}
              onSelect={setSelectedKey}
              resetKey={`${filter}:${query}`}
            />
          )}
        </div>

        <aside className="jira-detail">
          {selected ? (
            <>
              <div className="jira-detail-heading">
                <span>{selected.projectName}</span>
                <h2>{selected.summary}</h2>
                <p>{selected.key}</p>
              </div>
              <dl>
                <div><dt>상태</dt><dd><StatusBadge issue={selected} /></dd></div>
                <div><dt>우선순위</dt><dd>{selected.priority || "없음"}</dd></div>
                <div><dt>마감일</dt><dd>{selected.dueDate || "없음"}</dd></div>
                <div><dt>최근 변경</dt><dd>{formatRelativeDate(selected.updatedAt)}</dd></div>
              </dl>
              <div className="jira-task-link">
                <span>Orbit Task</span>
                {selectedLink ? (
                  <strong>{selectedLink.workItemTitle}</strong>
                ) : (
                  <label className="status-select">
                    <select value="" disabled={connectingKey === selected.key} onChange={(event) => void connectToTask(event.target.value)}>
                      <option value="">{connectingKey === selected.key ? "연결 중…" : "내 할 일에 연결…"}</option>
                      {openWorkItems.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
                    </select>
                    <i aria-hidden="true">⌄</i>
                  </label>
                )}
                <small>연결하면 Task의 Jira·PR·커밋 컨텍스트로 함께 관리됩니다.</small>
              </div>
              <button className="primary-button jira-open-button" type="button" onClick={() => void openUrl(selected.url)}>Jira에서 열기 ↗</button>
            </>
          ) : <div className="jira-empty">티켓을 선택하세요.</div>}
        </aside>
      </div>
    </section>
  );
}

const JiraRow = memo(function JiraRow({ issue, linkedTask, selected, onSelect }: {
  issue: JiraIssue;
  linkedTask?: JiraTaskLink;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button className={`jira-row ${selected ? "selected" : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(issue.key)}>
      <span className="jira-key">{issue.key}</span>
      <span className="jira-row-copy"><strong>{issue.summary}</strong><small>{issue.projectName} · {formatRelativeDate(issue.updatedAt)}</small></span>
      <span className="jira-row-state"><StatusBadge issue={issue} />{linkedTask && <small>{linkedTask.workItemTitle}</small>}</span>
    </button>
  );
});

const VirtualJiraList = memo(function VirtualJiraList({ issues, selectedKey, linkByKey, onSelect, resetKey }: {
  issues: JiraIssue[];
  selectedKey: string | null;
  linkByKey: Map<string, JiraTaskLink>;
  onSelect: (key: string) => void;
  resetKey: string;
}) {
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
  return (
    <div className="virtual-jira-viewport" ref={viewportRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="virtual-jira-space" style={{ height: issues.length * ROW_HEIGHT }}>
        <div className="virtual-jira-window" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {issues.slice(start, end).map((issue) => (
            <JiraRow key={issue.key} issue={issue} linkedTask={linkByKey.get(issue.key)} selected={selectedKey === issue.key} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
});

function StatusBadge({ issue }: { issue: JiraIssue }) {
  return <span className={`jira-status ${issue.statusCategory}`}>{issue.status}</span>;
}

function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 43_200) return `${Math.floor(minutes / 1_440)}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(timestamp);
}
