import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { WorkItem } from "../domain/work-item";
import {
  displaySessionPrompt,
  displaySessionTitle,
  projectName,
  sessionActivity,
  type AiProvider,
  type AiSession,
} from "../domain/ai-session";
import {
  acknowledgeAiSession,
  linkAiSession,
  listAiSessions,
  syncLocalAiSessions,
  updateAiSessionTitle,
} from "../data/ai-session-repository";
import { createWorkItem } from "../data/work-item-repository";
import { listWorkItemLinks } from "../data/work-item-link-repository";
import type { WorkItemLink } from "../domain/work-item-link";
import "./WorkspacePage.scss";

type ProviderFilter = "all" | AiProvider;
const SESSION_ROW_HEIGHT = 70;
const SESSION_OVERSCAN = 5;

interface WorkspacePageProps {
  workItems: WorkItem[];
  onWorkItemsChanged: () => Promise<void>;
  onOpenTask: (id: string) => void;
}

export default function WorkspacePage({ workItems, onWorkItemsChanged, onOpenTask }: WorkspacePageProps) {
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalSessionKey, setModalSessionKey] = useState<string | null>(null);

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const next = await syncLocalAiSessions();
      setSessions(next);
      setSelectedKey((current) => current ?? (next[0] ? sessionKey(next[0]) : null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const cached = await listAiSessions();
        if (cancelled) return;
        if (cached.length > 0) {
          setSessions(cached);
          setSelectedKey(sessionKey(cached[0]));
          setIsLoading(false);
        } else {
          await refresh();
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setIsLoading(false);
        }
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return sessions.filter((session) => {
      if (filter !== "all" && session.provider !== filter) return false;
      if (!keyword) return true;
      return [displaySessionTitle(session), session.cwd, displaySessionPrompt(session.firstPrompt), displaySessionPrompt(session.lastPrompt)]
        .some((value) => value?.toLocaleLowerCase().includes(keyword));
    });
  }, [filter, query, sessions]);

  const selected = sessions.find((session) => sessionKey(session) === selectedKey) ?? filtered[0] ?? null;
  const modalSession = sessions.find((session) => sessionKey(session) === modalSessionKey) ?? null;
  const linkedTask = selected ? workItems.find((item) => item.id === selected.linkedWorkItemId) : undefined;
  const openTasks = workItems.filter((item) => item.status !== "done");
  const recentCount = sessions.filter((session) => sessionActivity(session).isRecentlyActive).length;
  const attentionCount = sessions.filter((session) => sessionActivity(session).needsAttention).length;

  const selectSession = useCallback(async (session: AiSession) => {
    setSelectedKey(sessionKey(session));
    if (sessionActivity(session).needsAttention) {
      await acknowledgeAiSession(session.provider, session.sessionId);
      setSessions((current) => current.map((candidate) =>
        sessionKey(candidate) === sessionKey(session)
          ? { ...candidate, acknowledgedAtMs: candidate.modifiedAtMs }
          : candidate,
      ));
    }
  }, []);

  async function createTaskFromSession(session: AiSession) {
    const createdId = await createWorkItem({
      title: displaySessionTitle(session),
      status: "todo",
      goal: displaySessionPrompt(session.firstPrompt) || undefined,
      nextAction: displaySessionPrompt(session.lastPrompt)
        ? `세션의 마지막 요청 확인: ${displaySessionPrompt(session.lastPrompt)}`
        : "AI 세션 결과 확인",
    });
    await linkAiSession(session.provider, session.sessionId, createdId);
    setSessions((current) => current.map((candidate) =>
      sessionKey(candidate) === sessionKey(session) ? { ...candidate, linkedWorkItemId: createdId } : candidate,
    ));
    await onWorkItemsChanged();
  }

  async function updateLink(session: AiSession, workItemId: string) {
    const linkedWorkItemId = workItemId || null;
    await linkAiSession(session.provider, session.sessionId, linkedWorkItemId);
    setSessions((current) => current.map((candidate) =>
      sessionKey(candidate) === sessionKey(session) ? { ...candidate, linkedWorkItemId } : candidate,
    ));
  }

  return (
    <section className="sessions-page">
      <header className="sessions-toolbar">
        <div className="session-stats">
          <Stat label="발견한 세션" value={sessions.length} />
          <Stat label="최근 활동" value={recentCount} />
          <Stat label="확인 안 한 변경" value={attentionCount} accent />
          <Stat label="태스크 연결" value={sessions.filter((session) => session.linkedWorkItemId).length} />
        </div>
        <button type="button" onClick={() => void refresh()} disabled={isLoading}>{isLoading ? "스캔 중…" : "다시 스캔"}</button>
      </header>

      <div className="session-controls">
        <div className="provider-filter" aria-label="AI 제공자 필터">
          {(["all", "claude", "codex"] as const).map((provider) => (
            <button className={filter === provider ? "active" : ""} type="button" key={provider} onClick={() => setFilter(provider)}>
              {provider === "all" ? "전체" : provider === "claude" ? "Claude" : "Codex"}
            </button>
          ))}
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="세션, 프롬프트, 프로젝트 검색" aria-label="세션 검색" />
      </div>

      {error ? (
        <div className="session-error"><strong>로컬 세션을 읽지 못했습니다.</strong><span>{error}</span></div>
      ) : (
        <div className="session-layout">
          <div className="session-list" aria-label="로컬 AI 세션">
            {isLoading && sessions.length === 0 ? <div className="session-empty">로컬 세션을 찾는 중…</div> : filtered.length === 0 ? (
              <div className="session-empty"><strong>표시할 세션이 없습니다</strong><span>Claude Code 또는 Codex 세션이 로컬에 생성되면 여기에 나타납니다.</span></div>
            ) : (
              <VirtualSessionList
                sessions={filtered}
                selectedKey={selected ? sessionKey(selected) : null}
                onSelect={selectSession}
                onOpen={(session) => setModalSessionKey(sessionKey(session))}
                resetKey={`${filter}:${query}`}
              />
            )}
          </div>

          <aside className="session-detail">
            {selected ? (
              <>
                <div className="session-detail-heading">
                  <div><span>세션 상세 · {projectName(selected.cwd)}</span><h2>{displaySessionTitle(selected)}</h2></div>
                  <span className={`provider-pill ${selected.provider}`}><ProviderIcon provider={selected.provider} size={12} />{selected.provider}</span>
                </div>

                <dl className="session-meta">
                  <div><dt>최근 갱신</dt><dd>{formatDateTime(selected.modifiedAtMs)}</dd></div>
                  <div><dt>모델</dt><dd>{selected.model || "확인되지 않음"}</dd></div>
                  <div><dt>메시지</dt><dd>{selected.messageCount}개</dd></div>
                  <div><dt>세션 ID</dt><dd title={selected.sessionId}>{shortId(selected.sessionId)}</dd></div>
                </dl>

                <div className="prompt-card"><span>시작한 요청</span><p>{displaySessionPrompt(selected.firstPrompt) || "내부 컨텍스트를 제외한 요청이 없습니다."}</p></div>
                <div className="prompt-card last"><span>마지막 요청</span><p>{displaySessionPrompt(selected.lastPrompt) || "내부 컨텍스트를 제외한 요청이 없습니다."}</p></div>

                <div className="session-task-link">
                  <div><strong>Orbit Task</strong><span>이 세션을 작업의 컨텍스트로 연결합니다.</span></div>
                  {linkedTask ? (
                    <div className="linked-task">
                      <button type="button" onClick={() => onOpenTask(linkedTask.id)}><strong>{linkedTask.title}</strong><span>Task에서 보기 →</span></button>
                      <button type="button" className="unlink-button" onClick={() => void updateLink(selected, "")}>연결 해제</button>
                    </div>
                  ) : (
                    <>
                      <select value="" onChange={(event) => void updateLink(selected, event.target.value)}>
                        <option value="">기존 태스크 선택…</option>
                        {openTasks.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
                      </select>
                      <button className="primary-button" type="button" onClick={() => void createTaskFromSession(selected)}>새 태스크로 만들기</button>
                    </>
                  )}
                </div>

                <div className="privacy-note">로컬 JSONL에서 필요한 메타데이터와 요청 미리보기만 읽습니다. 대화 원문과 인증 파일은 Orbit DB에 복사하지 않습니다.</div>
              </>
            ) : <div className="session-empty">세션을 선택하세요.</div>}
          </aside>
        </div>
      )}
      {modalSession && (
        <SessionDetailModal
          session={modalSession}
          linkedTask={workItems.find((item) => item.id === modalSession.linkedWorkItemId) || null}
          onClose={() => setModalSessionKey(null)}
          onOpenTask={onOpenTask}
          onRenamed={(customTitle) => setSessions((current) => current.map((session) =>
            sessionKey(session) === sessionKey(modalSession) ? { ...session, customTitle } : session,
          ))}
        />
      )}
    </section>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className={accent && value > 0 ? "accent" : ""}><span>{label}</span><strong>{value}</strong></div>;
}

const SessionRow = memo(function SessionRow({
  session,
  selected,
  onSelect,
  onOpen,
}: {
  session: AiSession;
  selected: boolean;
  onSelect: (session: AiSession) => Promise<void>;
  onOpen: (session: AiSession) => void;
}) {
  const activity = sessionActivity(session);
  return (
    <button
      type="button"
      className={`session-row ${selected ? "selected" : ""}`}
      onClick={() => void onSelect(session)}
      onDoubleClick={() => onOpen(session)}
      aria-pressed={selected}
    >
      <span className={`provider-mark ${session.provider}`}><ProviderIcon provider={session.provider} size={15} /></span>
      <span className="session-copy">
        <strong>{displaySessionTitle(session)}</strong>
        <small>{projectName(session.cwd)} · {formatRelativeTime(session.modifiedAtMs)}</small>
      </span>
      <span className="session-signals">
        {activity.needsAttention && <i aria-label="확인하지 않은 변경" />}
        {activity.isRecentlyActive && <em>최근 활동</em>}
        {session.linkedWorkItemId && <small>Task</small>}
      </span>
    </button>
  );
});

function ProviderIcon({ provider, size }: { provider: AiProvider; size: number }) {
  if (provider === "claude") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
  );
}

const VirtualSessionList = memo(function VirtualSessionList({
  sessions,
  selectedKey,
  onSelect,
  onOpen,
  resetKey,
}: {
  sessions: AiSession[];
  selectedKey: string | null;
  onSelect: (session: AiSession) => Promise<void>;
  onOpen: (session: AiSession) => void;
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

  const visibleCount = Math.ceil(viewportHeight / SESSION_ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / SESSION_ROW_HEIGHT) - SESSION_OVERSCAN);
  const end = Math.min(sessions.length, start + visibleCount + SESSION_OVERSCAN * 2);
  const visibleSessions = sessions.slice(start, end);

  return (
    <div
      className="virtual-session-viewport"
      ref={viewportRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-session-space" style={{ height: sessions.length * SESSION_ROW_HEIGHT }}>
        <div className="virtual-session-window" style={{ transform: `translateY(${start * SESSION_ROW_HEIGHT}px)` }}>
          {visibleSessions.map((session) => (
            <SessionRow
              key={sessionKey(session)}
              session={session}
              selected={selectedKey === sessionKey(session)}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

function SessionDetailModal({
  session,
  linkedTask,
  onClose,
  onOpenTask,
  onRenamed,
}: {
  session: AiSession;
  linkedTask: WorkItem | null;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onRenamed: (title: string) => void;
}) {
  const [title, setTitle] = useState(displaySessionTitle(session));
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linkedTask) {
      setLinks([]);
      return;
    }
    void listWorkItemLinks(linkedTask.id).then(setLinks).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [linkedTask]);

  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    try {
      setError(null);
      await updateAiSessionTitle(session.provider, session.sessionId, title);
      onRenamed(title.trim());
      setIsEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="session-modal-backdrop" onMouseDown={onClose}>
      <section className="session-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className={`session-modal-icon ${session.provider}`}><ProviderIcon provider={session.provider} size={20} /></div>
          <div>
            <span>{session.provider === "claude" ? "Claude Code" : "Codex"} · {projectName(session.cwd)}</span>
            {isEditing ? (
              <form className="session-title-form" onSubmit={saveTitle}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus aria-label="세션 이름" />
                <button className="primary-button" type="submit">저장</button>
                <button type="button" onClick={() => { setTitle(displaySessionTitle(session)); setIsEditing(false); }}>취소</button>
              </form>
            ) : (
              <div className="session-modal-title"><h2>{displaySessionTitle(session)}</h2><button type="button" onClick={() => setIsEditing(true)}>이름 수정</button></div>
            )}
          </div>
          <button className="session-modal-close" type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>

        <dl className="session-modal-meta">
          <div><dt>최근 갱신</dt><dd>{formatDateTime(session.modifiedAtMs)}</dd></div>
          <div><dt>모델</dt><dd>{session.model || "확인되지 않음"}</dd></div>
          <div><dt>메시지</dt><dd>{session.messageCount}개</dd></div>
          <div><dt>세션 ID</dt><dd>{shortId(session.sessionId)}</dd></div>
        </dl>

        <div className="session-modal-section">
          <div className="session-modal-section-title"><strong>연결된 Orbit Task</strong><span>SSOT</span></div>
          {linkedTask ? (
            <button className="session-linked-task" type="button" onClick={() => onOpenTask(linkedTask.id)}>
              <div><strong>{linkedTask.title}</strong><span>{statusLabel(linkedTask.status)}</span></div><b>Task에서 보기 →</b>
            </button>
          ) : <div className="session-modal-empty">연결된 Task가 없습니다. 오른쪽 상세 영역에서 먼저 연결해주세요.</div>}
        </div>

        <div className="session-modal-section">
          <div className="session-modal-section-title"><strong>추적 중인 외부 업무</strong><span>{links.length}개</span></div>
          {links.length ? links.map((link) => (
            <div className="session-tracked-link" key={link.id}>
              <i className={link.kind}>{link.kind === "jira" ? "J" : link.kind === "github_pr" ? "PR" : "⌁"}</i>
              <div><strong>{link.label}</strong><span>{linkKindLabel(link.kind)}</span></div>
              <em>{link.status === "linked" ? "연결됨" : link.status}</em>
            </div>
          )) : <div className="session-modal-empty">Task에 연결된 Jira, GitHub PR 또는 커밋이 없습니다.</div>}
        </div>

        {error && <div className="session-modal-error">{error}</div>}
      </section>
    </div>
  );
}

function linkKindLabel(kind: WorkItemLink["kind"]) {
  if (kind === "jira") return "Jira 이슈";
  if (kind === "github_pr") return "GitHub Pull Request";
  return "GitHub Commit";
}

function statusLabel(status: WorkItem["status"]) {
  const labels: Record<WorkItem["status"], string> = {
    inbox: "Inbox", todo: "할 일", focus: "집중 중", ai_running: "AI 작업 중",
    review: "내 확인 필요", blocked: "막힘", done: "완료",
  };
  return labels[status];
}

function sessionKey(session: Pick<AiSession, "provider" | "sessionId">) { return `${session.provider}:${session.sessionId}`; }
function shortId(id: string) { return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id; }
function formatDateTime(value: number) { return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value); }
function formatRelativeTime(value: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}일 전` : formatDateTime(value);
}
