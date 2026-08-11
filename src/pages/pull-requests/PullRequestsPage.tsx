import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorkItem } from "../../entities/work-context/model/work-item";
import type { GitHubPullRequest, PullRequestTaskLink } from "../../entities/work-context/model/github-pull-request";
import {
  listCachedPullRequests,
  listPullRequestTaskLinks,
  refreshPullRequestsFromSessions,
} from "../../entities/work-context/api/github-pull-request-repository";
import { createWorkItemLink } from "../../entities/work-context/api/work-item-link-repository";
import "./PullRequestsPage.scss";

type Filter = "all" | "session" | "linked";
type PullRequestView = "authored" | "review";
const PR_ROW_HEIGHT = 84;
const PR_OVERSCAN = 5;

export default function PullRequestsPage({ workItems }: { workItems: WorkItem[] }) {
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [links, setLinks] = useState<PullRequestTaskLink[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<PullRequestView>("authored");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCache = useCallback(async () => {
    const [cached, nextLinks] = await Promise.all([
      listCachedPullRequests(),
      listPullRequestTaskLinks(),
    ]);
    setPullRequests(cached);
    setLinks(nextLinks);
    setSelectedUrl((current) => current && cached.some((item) => item.url === current)
      ? current
      : cached[0]?.url || null);
    return cached;
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshPullRequestsFromSessions();
      await loadCache();
      if (result.repositoriesScanned === 0 && result.pullRequests.length === 0) {
        setNotice("AI 세션 경로에서 GitHub 저장소를 찾지 못했습니다.");
      } else if (result.warnings.length > 0) {
        setNotice(`${result.repositoriesSucceeded}/${result.repositoriesScanned}개 저장소를 갱신했습니다.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsRefreshing(false);
    }
  }, [loadCache]);

  useEffect(() => {
    let active = true;
    void loadCache()
      .then(() => {
        if (active) void refresh();
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [loadCache, refresh]);

  const linkByUrl = useMemo(() => new Map(links.map((link) => [link.url, link])), [links]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return pullRequests.filter((item) => {
      if (view === "authored" && !item.authoredByViewer) return false;
      if (view === "review" && !item.reviewRequested) return false;
      if (filter === "session" && item.sessionMatchCount === 0) return false;
      if (filter === "linked" && !linkByUrl.has(item.url)) return false;
      return !normalized || `${item.repository} ${item.title} ${item.headRefName}`.toLocaleLowerCase().includes(normalized);
    });
  }, [filter, linkByUrl, pullRequests, query, view]);

  const selected = filtered.find((item) => item.url === selectedUrl) || filtered[0] || null;
  const selectedLink = selected ? linkByUrl.get(selected.url) : undefined;

  async function connectTask(workItemId: string) {
    if (!selected || !workItemId) return;
    setError(null);
    try {
      await createWorkItemLink(workItemId, "github_pr", selected.url);
      setLinks(await listPullRequestTaskLinks());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="pull-requests-page">
      <div className="pr-overview">
        <div><span>내가 올린 열린 PR{isRefreshing ? " · 동기화 중" : ""}</span><strong>{pullRequests.filter((item) => item.authoredByViewer).length}</strong></div>
        <div><span>내 리뷰 대기</span><strong className="accent">{pullRequests.filter((item) => item.reviewRequested).length}</strong></div>
        <div><span>세션 브랜치 일치</span><strong>{pullRequests.filter((item) => item.sessionMatchCount > 0).length}</strong></div>
        <div><span>Task 연결</span><strong>{links.length}</strong></div>
      </div>

      <div className="pr-toolbar">
        <div className="pr-toolbar-groups">
          <div className="pr-view-switch" role="tablist" aria-label="Pull Request 구분">
            <button className={view === "authored" ? "active" : ""} type="button" role="tab" aria-selected={view === "authored"} onClick={() => setView("authored")}>내가 올린 PR</button>
            <button className={view === "review" ? "active" : ""} type="button" role="tab" aria-selected={view === "review"} onClick={() => setView("review")}>내 리뷰 대기 <span>{pullRequests.filter((item) => item.reviewRequested).length}</span></button>
          </div>
          <div className="pr-filters">
            <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>전체</button>
            <button className={filter === "session" ? "active" : ""} type="button" onClick={() => setFilter("session")}>세션 브랜치</button>
            <button className={filter === "linked" ? "active" : ""} type="button" onClick={() => setFilter("linked")}>Task 연결됨</button>
          </div>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PR, 저장소, 브랜치 검색" aria-label="Pull Request 검색" />
      </div>

      {error && <div className="pr-message error">{error}</div>}
      {notice && <div className="pr-message">{notice}</div>}

      <div className="pr-content">
        <div className="pr-list" aria-label={view === "review" ? "내 리뷰 대기 Pull Request 목록" : "내가 올린 Pull Request 목록"}>
          {isLoading ? (
            <div className="pr-empty">캐시를 불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div className="pr-empty">
              <strong>{view === "review" ? "리뷰가 요청된 열린 Pull Request가 없습니다" : "내가 올린 열린 Pull Request가 없습니다"}</strong>
              <span>AI 세션의 Git 저장소를 기준으로 탭에 들어올 때마다 자동 확인합니다.</span>
            </div>
          ) : (
            <VirtualPullRequestList
              pullRequests={filtered}
              selectedUrl={selected?.url || null}
              linkByUrl={linkByUrl}
              onSelect={setSelectedUrl}
              resetKey={`${view}:${filter}:${query}`}
            />
          )}
        </div>

        <aside className="pr-detail">
          {selected ? (
            <>
              <div className="pr-detail-heading">
                <span>{selected.repository} · #{selected.number}</span>
                <h2>{selected.title}</h2>
                <p>{selected.headRefName && selected.baseRefName ? <>{selected.headRefName} <i>→</i> {selected.baseRefName}</> : "브랜치 정보는 GitHub에서 확인"}</p>
              </div>
              <dl>
                <div><dt>작성자</dt><dd>{selected.authorLogin ? `@${selected.authorLogin}` : "알 수 없음"}</dd></div>
                <div><dt>최근 변경</dt><dd>{formatRelativeDate(selected.updatedAt)}</dd></div>
                <div><dt>AI 세션</dt><dd>{selected.sessionMatchCount > 0 ? `같은 브랜치 ${selected.sessionMatchCount}개` : "직접 일치 없음"}</dd></div>
              </dl>
              <div className="pr-task-link">
                <span>Orbit Task</span>
                {selectedLink ? (
                  <strong>{selectedLink.workItemTitle}</strong>
                ) : (
                  <label className="status-select">
                    <select value="" onChange={(event) => void connectTask(event.target.value)}>
                      <option value="">Task에 연결…</option>
                      {workItems.filter((item) => item.status !== "done").map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                    <i aria-hidden="true">⌄</i>
                  </label>
                )}
                <small>PR 연결은 Task에 저장되며 AI 세션 원본은 변경하지 않습니다.</small>
              </div>
              <button className="primary-button pr-open-button" type="button" onClick={() => void openUrl(selected.url)}>GitHub에서 열기 ↗</button>
            </>
          ) : <div className="pr-empty">PR을 선택하세요.</div>}
        </aside>
      </div>
    </section>
  );
}

const PullRequestRow = memo(function PullRequestRow({
  pullRequest,
  linkedTask,
  selected,
  onSelect,
}: {
  pullRequest: GitHubPullRequest;
  linkedTask?: PullRequestTaskLink;
  selected: boolean;
  onSelect: (url: string) => void;
}) {
  return (
    <button
      className={`pr-row ${selected ? "selected" : ""}`}
      type="button"
      onClick={() => onSelect(pullRequest.url)}
      aria-pressed={selected}
    >
      <GitHubIcon />
      <div className="pr-row-copy">
        <span>{pullRequest.repository} #{pullRequest.number}</span>
        <strong>{pullRequest.title}</strong>
        <small>{pullRequest.headRefName && pullRequest.baseRefName ? `${pullRequest.headRefName} → ${pullRequest.baseRefName}` : `@${pullRequest.authorLogin || "unknown"} · 리뷰 대기`}</small>
      </div>
      <div className="pr-row-state">
        {pullRequest.sessionMatchCount > 0 && <em>세션 {pullRequest.sessionMatchCount}</em>}
        {pullRequest.reviewRequested && <em className="review-requested">리뷰 요청</em>}
        {linkedTask && <span>{linkedTask.workItemTitle}</span>}
        {pullRequest.isDraft && <small>Draft</small>}
      </div>
    </button>
  );
});

const VirtualPullRequestList = memo(function VirtualPullRequestList({
  pullRequests,
  selectedUrl,
  linkByUrl,
  onSelect,
  resetKey,
}: {
  pullRequests: GitHubPullRequest[];
  selectedUrl: string | null;
  linkByUrl: Map<string, PullRequestTaskLink>;
  onSelect: (url: string) => void;
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

  const visibleCount = Math.ceil(viewportHeight / PR_ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / PR_ROW_HEIGHT) - PR_OVERSCAN);
  const end = Math.min(pullRequests.length, start + visibleCount + PR_OVERSCAN * 2);
  const visiblePullRequests = pullRequests.slice(start, end);

  return (
    <div
      className="virtual-pr-viewport"
      ref={viewportRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-pr-space" style={{ height: pullRequests.length * PR_ROW_HEIGHT }}>
        <div className="virtual-pr-window" style={{ transform: `translateY(${start * PR_ROW_HEIGHT}px)` }}>
          {visiblePullRequests.map((pullRequest) => (
            <PullRequestRow
              key={pullRequest.url}
              pullRequest={pullRequest}
              linkedTask={linkByUrl.get(pullRequest.url)}
              selected={selectedUrl === pullRequest.url}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1_440)}일 전`;
}

function GitHubIcon() {
  return (
    <svg className="github-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49v-1.91c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.35 1.12 2.92.86.09-.66.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.34 9.34 0 0 1 12 6.94a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}
