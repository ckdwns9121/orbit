import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.scss";
import {
  createWorkItem,
  deleteWorkItem,
  listWorkItems,
  moveWorkItem,
  updateCheckpoint,
  updateWorkItemTitle,
} from "./data/work-item-repository";
import {
  linkAiSession,
  listAiSessions,
  listWorkItemSessionProgress,
  setAiSessionCompletion,
  type WorkItemSessionProgress,
} from "./data/ai-session-repository";
import {
  deleteWorkItemLink,
  listWorkItemLinks,
} from "./data/work-item-link-repository";
import {
  getCachedJiraIssueDevelopment,
  syncJiraIssueDevelopment,
} from "./data/jira-development-repository";
import { autoConnectTaskAiSessions } from "./data/context-discovery-repository";
import {
  statusMeta,
  workItemStatuses,
  type WorkItem,
  type WorkItemStatus,
} from "./domain/work-item";
import { displaySessionTitle, projectName, type AiSession } from "./domain/ai-session";
import {
  shouldRefreshJiraDevelopment,
  type JiraIssueDevelopment,
} from "./domain/jira-development";
import type { WorkItemLink } from "./domain/work-item-link";
import { taskStatusForSessions } from "./domain/task-flow";
import { requiresCheckpoint, type WorkItemTransition } from "./domain/workflow";
import CalendarPage from "./calendar/CalendarPage";
import SettingsPage from "./settings/SettingsPage";
import WorkspacePage from "./workspace/WorkspacePage";
import PullRequestsPage from "./pull-requests/PullRequestsPage";
import JiraTicketsPage from "./jira/JiraTicketsPage";
import TaskContextDiscoveryModal from "./context/TaskContextDiscoveryModal";
import ChatPage from "./chat/ChatPage";
import DashboardPage from "./dashboard/DashboardPage";

type PrimarySection = "dashboard" | "tasks" | "calendar" | "chat" | "sessions" | "jira" | "pull_requests" | "settings";
type TaskTab = "today" | "todo" | "ai_running" | "done";

const taskTabs: Array<{ id: TaskTab; label: string }> = [
  { id: "todo", label: "할 일" },
  { id: "ai_running", label: "진행 중" },
  { id: "done", label: "완료" },
];

function formatToday() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

function App() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [discoveryTask, setDiscoveryTask] = useState<{ id: string; title: string } | null>(null);
  const [pendingTransition, setPendingTransition] = useState<WorkItemTransition | null>(null);
  const [activeSection, setActiveSection] = useState<PrimarySection>("dashboard");
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>("todo");
  const [contextItem, setContextItem] = useState<WorkItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<WorkItem | null>(null);
  const [sessionProgress, setSessionProgress] = useState<Record<string, WorkItemSessionProgress>>({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [nextItems, nextProgress] = await Promise.all([
        listWorkItems(),
        listWorkItemSessionProgress(),
      ]);
      setItems(nextItems);
      setSessionProgress(nextProgress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groupedItems = useMemo(() => {
    return Object.fromEntries(
      workItemStatuses.map((status) => [
        status,
        items.filter((item) => item.status === status),
      ]),
    ) as Record<WorkItemStatus, WorkItem[]>;
  }, [items]);

  const focusItem = groupedItems.focus[0];
  const nextItems = [...groupedItems.review, ...groupedItems.todo].slice(0, 5);

  async function commitMove(id: string, status: WorkItemStatus) {
    try {
      setError(null);
      await moveWorkItem(id, status);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleMove(id: string, status: WorkItemStatus) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.status === status) return;

    const transition = { targetId: id, targetStatus: status };
    if (requiresCheckpoint(focusItem?.id, transition)) {
      setPendingTransition(transition);
      return;
    }

    await commitMove(id, status);
  }

  async function handleRename(id: string, title: string) {
    await updateWorkItemTitle(id, title);
    await refresh();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="brand">
          <strong>Orbit</strong>
          <span>{formatToday()}</span>
        </div>

        <nav aria-label="주요 메뉴">
          <button className={`nav-item ${activeSection === "dashboard" ? "active" : ""}`} type="button" onClick={() => setActiveSection("dashboard")}><span className="nav-symbol">◫</span>Dashboard<b /></button>
          <button
            className={`nav-item ${activeSection === "chat" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("chat")}
          >
            <span className="nav-symbol">✦</span>
            Chat
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "tasks" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("tasks")}
          >
            <span className="nav-symbol">✓</span>
            Task
            <b>{items.filter((item) => item.status !== "done").length || ""}</b>
          </button>
          <button
            className={`nav-item ${activeSection === "calendar" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("calendar")}
          >
            <span className="nav-symbol">▦</span>
            Calendar
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "sessions" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("sessions")}
          >
            <span className="nav-symbol">⌘</span>
            Workspace
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "jira" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("jira")}
          >
            <span className="nav-symbol">J</span>
            Jira Tickets
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "pull_requests" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("pull_requests")}
          >
            <span className="nav-symbol"><GitHubNavIcon /></span>
            Pull Requests
            <b />
          </button>

          <div className="nav-separator" />
          <button className="nav-item nav-item-muted" type="button" disabled>
            <span className="nav-symbol">↔</span> Integrations <b />
          </button>
          <button
            className={`nav-item ${activeSection === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveSection("settings")}
          >
            <span className="nav-symbol">⚙</span> Settings <b />
          </button>
        </nav>

        <div className="sync-status">
          <span className="sync-dot" />
          로컬에 저장됨
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{activeSection === "dashboard" ? "Dashboard" : activeSection === "tasks" ? "Task" : activeSection === "calendar" ? "Calendar" : activeSection === "chat" ? "Chat" : activeSection === "sessions" ? "Workspace" : activeSection === "jira" ? "Jira Tickets" : activeSection === "pull_requests" ? "Pull Requests" : "Settings"}</h1>
            <span>{formatToday()}</span>
          </div>
          {activeSection === "tasks" && (
            <button className="primary-button" type="button" onClick={() => setIsComposerOpen(true)}>
              + 작업 추가
            </button>
          )}
        </header>

        {activeSection === "tasks" && (
          <nav className="task-tabs" aria-label="Task 보기">
            {taskTabs.map((tab) => (
              <button
                className={activeTaskTab === tab.id ? "active" : ""}
                type="button"
                key={tab.id}
                onClick={() => setActiveTaskTab(tab.id)}
              >
                {tab.label}
                {tab.id !== "today" && groupedItems[tab.id].length > 0 && <span>{groupedItems[tab.id].length}</span>}
              </button>
            ))}
          </nav>
        )}

        {activeSection === "dashboard" ? (
          <DashboardPage />
        ) : activeSection === "calendar" ? (
          <CalendarPage />
        ) : activeSection === "chat" ? (
          <ChatPage />
        ) : activeSection === "sessions" ? (
          <WorkspacePage
            workItems={items}
            onWorkItemsChanged={refresh}
            onOpenTask={(id) => {
              setActiveSection("tasks");
              const linked = items.find((item) => item.id === id);
              setActiveTaskTab(linked?.status === "done" ? "done" : linked?.status === "todo" ? "todo" : "ai_running");
            }}
          />
        ) : activeSection === "jira" ? (
          <JiraTicketsPage workItems={items} />
        ) : activeSection === "pull_requests" ? (
          <PullRequestsPage workItems={items} />
        ) : activeSection === "settings" ? (
          <SettingsPage />
        ) : (
          <>
        {error && (
          <div className="error-banner">
            작업을 변경하지 못했습니다.
            <small>{error}</small>
          </div>
        )}

        {activeTaskTab === "today" ? (
          <>
        <section className={`focus-panel ${focusItem ? "" : "empty-focus"}`}>
          <div className="section-kicker"><span /> 지금 집중</div>
          {focusItem ? (
            <>
              <div className="focus-heading">
                <div>
                  <h2>{focusItem.title}</h2>
                  <p>{focusItem.nextAction || "다음 행동을 기록하면 작업을 더 쉽게 재개할 수 있어요."}</p>
                </div>
                <div className="focus-actions">
                  <button type="button" className="primary-button" onClick={() => handleMove(focusItem.id, "done")}>완료</button>
                  <button type="button" onClick={() => handleMove(focusItem.id, "ai_running")}>AI에게 맡기기</button>
                  <button type="button" onClick={() => handleMove(focusItem.id, "blocked")}>막힘</button>
                </div>
              </div>
              <CheckpointEditor item={focusItem} onSaved={refresh} />
            </>
          ) : (
            <div className="focus-empty-content">
              <div>
                <h2>집중할 작업을 선택하세요</h2>
                <p>사람의 집중 작업은 한 번에 하나만 유지합니다.</p>
              </div>
              {groupedItems.todo[0] && (
                <button className="primary-button" type="button" onClick={() => handleMove(groupedItems.todo[0].id, "focus")}>
                  다음 작업 시작
                </button>
              )}
            </div>
          )}
        </section>

        <section className="summary-row" aria-label="작업 요약">
          <Summary label="내 확인 필요" value={groupedItems.review.length} accent />
          <Summary label="AI 작업 중" value={groupedItems.ai_running.length} />
          <Summary label="할 일" value={groupedItems.todo.length} />
          <Summary label="오늘 완료" value={groupedItems.done.length} />
        </section>

        <div className="content-grid">
          <section className="task-section">
            <div className="section-heading">
              <div>
                <h3>다음 작업</h3>
                <span>확인이 필요한 일과 실행할 준비가 된 일</span>
              </div>
              <span>{nextItems.length}개</span>
            </div>

            {isLoading ? (
              <div className="empty-state">작업을 불러오는 중…</div>
            ) : nextItems.length ? (
              <div className="task-list">
                {nextItems.map((item) => (
                  <TaskRow key={item.id} item={item} progress={sessionProgress[item.id]} onMove={handleMove} onRename={handleRename} onOpenContext={setContextItem} onDelete={setDeleteItem} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>다음 작업이 없습니다</strong>
                <span>작업을 추가해 오늘의 실행 순서를 만들어보세요.</span>
                <button type="button" onClick={() => setIsComposerOpen(true)}>첫 작업 추가</button>
              </div>
            )}
          </section>

          <aside className="attention-panel">
            <Queue title="내 확인 필요" items={groupedItems.review} onMove={handleMove} />
            <Queue title="AI 작업 중" items={groupedItems.ai_running} onMove={handleMove} />
            <Queue title="막힌 작업" items={groupedItems.blocked} onMove={handleMove} />
          </aside>
        </div>

        {groupedItems.done.length > 0 && (
          <details className="done-section">
            <summary>완료한 작업 <span>{groupedItems.done.length}</span></summary>
            <div className="task-list">
              {groupedItems.done.map((item) => (
                <TaskRow key={item.id} item={item} progress={sessionProgress[item.id]} onMove={handleMove} onRename={handleRename} onOpenContext={setContextItem} onDelete={setDeleteItem} />
              ))}
            </div>
          </details>
        )}
          </>
        ) : (
          <TaskStatusView
            status={activeTaskTab}
            items={groupedItems[activeTaskTab]}
            isLoading={isLoading}
            onMove={handleMove}
            onRename={handleRename}
            onOpenContext={setContextItem}
            onDelete={setDeleteItem}
            sessionProgress={sessionProgress}
            onAdd={() => setIsComposerOpen(true)}
          />
        )}
          </>
        )}
      </main>

      {isComposerOpen && (
        <TaskComposer
          onClose={() => setIsComposerOpen(false)}
          onCreated={async (task) => {
            setIsComposerOpen(false);
            setDiscoveryTask(task);
            await refresh();
          }}
        />
      )}
      {discoveryTask && (
        <TaskContextDiscoveryModal
          task={discoveryTask}
          onClose={() => setDiscoveryTask(null)}
          onConnected={async () => {
            setDiscoveryTask(null);
            await refresh();
          }}
        />
      )}

      {pendingTransition && focusItem && (
        <TransitionCheckpoint
          focusItem={focusItem}
          destination={
            pendingTransition.targetId === focusItem.id
              ? statusMeta[pendingTransition.targetStatus].label
              : items.find((item) => item.id === pendingTransition.targetId)?.title || "다음 작업"
          }
          onCancel={() => setPendingTransition(null)}
          onConfirm={async (checkpoint, nextAction) => {
            await updateCheckpoint(focusItem.id, checkpoint, nextAction);
            await commitMove(pendingTransition.targetId, pendingTransition.targetStatus);
            setPendingTransition(null);
          }}
        />
      )}

      {contextItem && (
        <TaskContextModal
          item={items.find((item) => item.id === contextItem.id) || contextItem}
          onClose={() => setContextItem(null)}
          onChanged={refresh}
        />
      )}
      {deleteItem && (
        <DeleteTaskModal
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onConfirm={async () => {
            await deleteWorkItem(deleteItem.id);
            setDeleteItem(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function Summary({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong className={accent && value > 0 ? "accent" : ""}>{value}</strong>
    </div>
  );
}

function TaskRow({
  item,
  progress,
  onMove,
  onRename,
  onOpenContext,
  onDelete,
}: {
  item: WorkItem;
  progress?: WorkItemSessionProgress;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onOpenContext: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function submitTitle(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      setRenameError(null);
      await onRename(item.id, title);
      setIsEditing(false);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <article className={`task-row ${item.status === "review" ? "needs-review" : ""}`}>
      <button
        className="check-button"
        type="button"
        aria-label={`${item.title} 완료`}
        onClick={() => onMove(item.id, "done")}
      />
      <div className="task-copy">
        {isEditing ? (
          <form className="task-title-editor" onSubmit={submitTitle}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus aria-label="작업 이름" />
            <button className="task-title-save" type="submit" aria-label="작업 이름 저장">✓</button>
            <button type="button" aria-label="취소" onClick={() => { setTitle(item.title); setIsEditing(false); }}>×</button>
          </form>
        ) : <strong onDoubleClick={() => setIsEditing(true)}>{item.title}</strong>}
        <span>{progress ? `AI 세션 ${progress.done}/${progress.total} 완료` : "AI 세션 연결 필요"}</span>
        {renameError && <small className="task-inline-error">{renameError}</small>}
      </div>
      <button className="task-icon-action" type="button" aria-label={`${item.title} 이름 수정`} onClick={() => setIsEditing(true)}>✎</button>
      <button className="task-delete-action" type="button" aria-label={`${item.title} 삭제`} onClick={() => onDelete(item)}><TrashIcon /></button>
      <button className="task-link-action" type="button" onClick={() => onOpenContext(item)}>연결</button>
      <label className="status-select">
        <span className="sr-only">{item.title} 상태</span>
        <select value={item.status} onChange={(event) => onMove(item.id, event.target.value as WorkItemStatus)}>
          <option value="todo">할 일</option>
          <option value="ai_running">진행 중</option>
          <option value="done">완료</option>
        </select>
        <i aria-hidden="true">⌄</i>
      </label>
    </article>
  );
}

function Queue({
  title,
  items,
  onMove,
}: {
  title: string;
  items: WorkItem[];
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
}) {
  return (
    <section className="queue">
      <div className="queue-title"><h3>{title}</h3><span>{items.length}</span></div>
      {items.slice(0, 3).map((item) => (
        <button type="button" className="queue-item" key={item.id} onClick={() => onMove(item.id, "focus")}>
          <strong>{item.title}</strong>
          <span>{item.nextAction || "집중 작업으로 가져오기"}</span>
        </button>
      ))}
      {items.length === 0 && <p className="queue-empty">현재 항목 없음</p>}
    </section>
  );
}

function CheckpointEditor({ item, onSaved }: { item: WorkItem; onSaved: () => Promise<void> }) {
  const [checkpoint, setCheckpoint] = useState(item.checkpoint || "");
  const [nextAction, setNextAction] = useState(item.nextAction || "");
  const [isEditing, setIsEditing] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    await updateCheckpoint(item.id, checkpoint, nextAction);
    setIsEditing(false);
    await onSaved();
  }

  if (!isEditing) {
    return (
      <button className="checkpoint-preview" type="button" onClick={() => setIsEditing(true)}>
        <span>체크포인트</span>
        <strong>{item.checkpoint || "현재까지 한 일을 기록하세요"}</strong>
        <small>편집</small>
      </button>
    );
  }

  return (
    <form className="checkpoint-form" onSubmit={save}>
      <label>현재까지 한 것<input value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} autoFocus /></label>
      <label>다음 행동<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
      <button type="submit">저장</button>
    </form>
  );
}

function TaskStatusView({
  status,
  items,
  isLoading,
  onMove,
  onRename,
  onOpenContext,
  onDelete,
  sessionProgress,
  onAdd,
}: {
  status: Exclude<WorkItemStatus, "focus">;
  items: WorkItem[];
  isLoading: boolean;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onOpenContext: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  sessionProgress: Record<string, WorkItemSessionProgress>;
  onAdd: () => void;
}) {
  const descriptions: Record<Exclude<WorkItemStatus, "focus">, string> = {
    inbox: "아직 분류하지 않은 작업",
    todo: "실행할 준비가 된 작업",
    ai_running: "연결된 AI 작업 세션이 진행 중인 작업",
    review: "AI 결과나 변경 내용을 확인해야 하는 작업",
    blocked: "외부 답변이나 선행 작업을 기다리는 작업",
    done: "완료한 작업",
  };

  return (
    <section className="task-status-page">
      <header>
        <div>
          <h2>{statusMeta[status].label}</h2>
          <p>{descriptions[status]}</p>
        </div>
        <span>{items.length}개</span>
      </header>

      {isLoading ? (
        <div className="empty-state">작업을 불러오는 중…</div>
      ) : items.length > 0 ? (
        <div className="task-list status-task-list">
          {items.map((item) => <TaskRow key={item.id} item={item} progress={sessionProgress[item.id]} onMove={onMove} onRename={onRename} onOpenContext={onOpenContext} onDelete={onDelete} />)}
        </div>
      ) : (
        <div className="empty-state">
          <strong>{statusMeta[status].label}에 작업이 없습니다</strong>
          {status !== "done" && <button type="button" onClick={onAdd}>작업 추가</button>}
        </div>
      )}
    </section>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GitHubNavIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49v-1.91c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.35 1.12 2.92.86.09-.66.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.34 9.34 0 0 1 12 6.94a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function DeleteTaskModal({
  item,
  onClose,
  onConfirm,
}: {
  item: WorkItem;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setIsDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="delete-task-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="delete-task-icon"><TrashIcon /></div>
        <h2>Task를 삭제할까요?</h2>
        <strong>{item.title}</strong>
        <p>Jira·GitHub 연결은 함께 제거됩니다. AI 세션 원본은 유지되고 이 Task와의 연결만 해제됩니다.</p>
        {error && <div className="context-error">{error}</div>}
        <div className="delete-task-actions">
          <button type="button" onClick={onClose} disabled={isDeleting}>취소</button>
          <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={isDeleting}>{isDeleting ? "삭제 중…" : "삭제"}</button>
        </div>
      </section>
    </div>
  );
}

function TaskComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (task: { id: string; title: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const normalizedTitle = title.trim();
      const id = await createWorkItem({ title: normalizedTitle, status: "todo" });
      await onCreated({ id, title: normalizedTitle });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="composer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="composer-heading">
          <div><span>새 Orbit Task</span><h2>무엇을 해야 하나요?</h2></div>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <label>작업 제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: GitHub OAuth callback 구현" autoFocus /></label>
        <p className="composer-flow-note">Task를 만들면 AI가 관련 Jira 티켓과 작업 세션을 찾아 연결을 제안합니다.</p>
        {saveError && <div className="composer-error" role="alert">저장하지 못했습니다. <small>{saveError}</small></div>}
        <div className="composer-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button className="primary-button" type="submit" disabled={isSaving || !title.trim()}>{isSaving ? "저장 중…" : "작업 추가"}</button>
        </div>
      </form>
    </div>
  );
}

function TaskContextModal({ item, onClose, onChanged }: { item: WorkItem; onClose: () => void; onChanged: () => Promise<void> }) {
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isJiraSyncing, setIsJiraSyncing] = useState(false);
  const [development, setDevelopment] = useState<JiraIssueDevelopment[]>([]);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectMessage, setAutoConnectMessage] = useState<string | null>(null);
  const syncedJiraLinksRef = useRef(new Set<string>());

  const refreshContext = useCallback(async () => {
    const [nextSessions, nextLinks] = await Promise.all([
      listAiSessions(),
      listWorkItemLinks(item.id),
    ]);
    setSessions(nextSessions);
    setLinks(nextLinks);
  }, [item.id]);

  useEffect(() => {
    let cancelled = false;
    setDevelopment([]);
    void refreshContext().then(async () => {
      const [nextSessions, nextLinks] = await Promise.all([listAiSessions(), listWorkItemLinks(item.id)]);
      const cwds = nextSessions
        .filter((session) => session.linkedWorkItemId === item.id && session.cwd)
        .map((session) => session.cwd as string);
      const jiraLinks = nextLinks.filter((link) => link.kind === "jira" && link.externalId);
      if (jiraLinks.length === 0 || cancelled) return;
      const cached = await Promise.all(jiraLinks.map((link) =>
        getCachedJiraIssueDevelopment(link.externalId!)));
      if (cancelled) return;
      setDevelopment(cached.flatMap((entry) => entry ? [entry.development] : []));
      const linksToRefresh = jiraLinks.filter((_, index) => shouldRefreshJiraDevelopment(cached[index]));
      if (linksToRefresh.length === 0) return;

      setIsJiraSyncing(true);
      try {
        const byIssueKey = new Map(cached.flatMap((entry) => entry
          ? [[entry.development.issue.key, entry.development] as const]
          : []));
        for (const link of linksToRefresh) {
          if (cancelled || syncedJiraLinksRef.current.has(link.id)) continue;
          syncedJiraLinksRef.current.add(link.id);
          const fresh = await syncJiraIssueDevelopment(item.id, link.id, link.externalId!, cwds);
          byIssueKey.set(fresh.issue.key, fresh);
        }
        if (!cancelled) {
          setDevelopment(jiraLinks.flatMap((link) => {
            const value = byIssueKey.get(link.externalId!);
            return value ? [value] : [];
          }));
          setLinks(await listWorkItemLinks(item.id));
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setIsJiraSyncing(false);
      }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [item.id, refreshContext]);

  const linkedSessions = sessions.filter((session) => session.linkedWorkItemId === item.id);

  async function disconnectSession(session: AiSession) {
    await linkAiSession(session.provider, session.sessionId, null);
    await refreshContext();
    await onChanged();
  }

  async function toggleSessionCompletion(session: AiSession) {
    const nextState = session.completionState === "done" ? "active" : "done";
    await setAiSessionCompletion(
      session.provider,
      session.sessionId,
      nextState,
    );
    const nextStates = linkedSessions.map((candidate) =>
      candidate.provider === session.provider && candidate.sessionId === session.sessionId
        ? nextState
        : candidate.completionState,
    );
    await moveWorkItem(item.id, taskStatusForSessions(nextStates));
    await refreshContext();
    await onChanged();
  }

  async function autoConnectSessions() {
    setIsAutoConnecting(true);
    setAutoConnectMessage(null);
    try {
      setError(null);
      const result = await autoConnectTaskAiSessions(item.id, item.title);
      setAutoConnectMessage(result.connected.length > 0
        ? `${result.connected.length}개의 관련 세션을 자동으로 연결했습니다.`
        : "관련도가 충분히 높은 AI 세션을 찾지 못했습니다.");
      await refreshContext();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsAutoConnecting(false);
    }
  }

  const jiraLinks = links.filter((link) => link.kind === "jira");

  return (
    <div className="modal-backdrop task-context-backdrop" onMouseDown={onClose}>
      <section className="task-context-modal task-context-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>Task · Context</span><h2>{item.title}</h2><p>Jira와 GitHub 개발 흐름, AI 작업 세션을 한곳에서 확인합니다.</p></div>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>

        <DevelopmentSection development={development} isLoading={isJiraSyncing} />

        <div className="context-section">
          <div className="context-section-title"><strong>Jira</strong><span>{isJiraSyncing ? "개발 정보 동기화 중…" : `${jiraLinks.length}개 연결됨`}</span></div>
          {jiraLinks.map((link) => (
            <div className="context-link-row external" key={link.id}>
              <i className="jira">J</i>
              <div><strong>{link.label}</strong><span>Jira 이슈{link.status !== "linked" ? ` · ${link.status}` : ""}</span></div>
              <div className="context-row-actions">
                {link.externalUrl && <button type="button" onClick={() => void openUrl(link.externalUrl!)}>열기</button>}
                <button type="button" onClick={async () => { await deleteWorkItemLink(link.id); await refreshContext(); }}>해제</button>
              </div>
            </div>
          ))}
          {jiraLinks.length === 0 && <div className="context-empty-row">연결된 Jira 티켓이 없습니다.</div>}
        </div>

        <div className="context-section ai-auto-section">
          <div className="context-section-title"><strong>AI 작업 세션</strong><span>{linkedSessions.length}개 연결됨</span></div>
          <button className="ai-auto-connect" type="button" onClick={() => void autoConnectSessions()} disabled={isAutoConnecting}>
            <i>✦</i>
            <span><strong>{isAutoConnecting ? "AI가 관련 세션을 찾는 중…" : "AI로 세션 자동 연결"}</strong><small>Task 제목과 최근 대화를 분석해 관련도가 높은 세션만 연결합니다.</small></span>
            <b>{isAutoConnecting ? "분석 중" : "자동 연결"}</b>
          </button>
          {autoConnectMessage && <p className="ai-auto-message">{autoConnectMessage}</p>}
          {linkedSessions.map((session) => (
            <div className="context-link-row" key={`${session.provider}:${session.sessionId}`}>
              <i className={session.provider}>{session.provider === "claude" ? "C" : "O"}</i>
              <div><strong>{displaySessionTitle(session)}</strong><span>{session.provider} · {projectName(session.cwd)} · {session.completionState === "done" ? "완료" : "진행 중"}</span></div>
              <div className="context-row-actions">
                <button className={session.completionState === "done" ? "done" : ""} type="button" onClick={() => void toggleSessionCompletion(session)}>{session.completionState === "done" ? "다시 진행" : "완료 표시"}</button>
                <button type="button" onClick={() => void disconnectSession(session)}>해제</button>
              </div>
            </div>
          ))}
        </div>
        {error && <div className="context-error">{error}</div>}
      </section>
    </div>
  );
}

function DevelopmentSection({ development, isLoading }: {
  development: JiraIssueDevelopment[];
  isLoading: boolean;
}) {
  const branches = development.flatMap((item) => item.branches);
  const commits = development.flatMap((item) => item.commits);
  const pullRequests = development.flatMap((item) => item.pullRequests);
  const builds = development.flatMap((item) => item.builds);
  const warnings = [...new Set(development.flatMap((item) => item.warnings))];
  const tickets = development.map((item) => `${item.issue.key} · ${item.issue.summary}`).join(", ");

  return (
    <div className="context-section development-section">
      <div className="context-section-title">
        <strong>Development</strong>
        <span>{isLoading ? "GitHub 개발 정보 찾는 중…" : tickets}</span>
      </div>
      <div className="development-summary" aria-label="GitHub 개발 정보 요약">
        <DevelopmentMetric symbol="⑂" label="브랜치" count={branches.length} />
        <DevelopmentMetric symbol="⌁" label="커밋" count={commits.length} />
        <DevelopmentMetric symbol="PR" label="Pull request" count={pullRequests.length} />
        <DevelopmentMetric symbol="✓" label="빌드" count={builds.length} tone={builds.some((build) => build.conclusion === "failure") ? "danger" : "success"} />
      </div>
      {!isLoading && branches.length + commits.length + pullRequests.length + builds.length === 0 && (
        <div className="development-empty">Jira 티켓 키가 포함된 GitHub 개발 정보를 찾지 못했습니다.</div>
      )}
      <DevelopmentDetails
        label="브랜치"
        items={branches.map((branch) => ({
          id: `${branch.repository}:${branch.name}`,
          title: branch.name,
          meta: branch.repository,
          url: branch.url,
        }))}
      />
      <DevelopmentDetails
        label="커밋"
        items={commits.map((commit) => ({
          id: `${commit.repository}:${commit.sha}`,
          title: `${commit.sha.slice(0, 7)} · ${commit.message}`,
          meta: `${commit.repository}${commit.authorName ? ` · ${commit.authorName}` : ""}`,
          url: commit.url,
        }))}
      />
      <DevelopmentDetails
        label="Pull requests"
        items={pullRequests.map((pullRequest) => ({
          id: `${pullRequest.repository}:${pullRequest.number}`,
          title: `#${pullRequest.number} · ${pullRequest.title}`,
          meta: `${pullRequest.repository} · ${formatDevelopmentStatus(pullRequest.status)}`,
          url: pullRequest.url,
        }))}
      />
      <DevelopmentDetails
        label="빌드"
        items={builds.map((build) => ({
          id: `${build.repository}:${build.id}`,
          title: build.name,
          meta: `${build.repository} · ${build.branch} · ${formatDevelopmentStatus(build.conclusion || build.status)}`,
          url: build.url,
        }))}
      />
      {warnings.length > 0 && <p className="development-warning">{warnings.join(" ")}</p>}
    </div>
  );
}

function DevelopmentMetric({ symbol, label, count, tone = "" }: {
  symbol: string;
  label: string;
  count: number;
  tone?: "" | "success" | "danger";
}) {
  return (
    <div className={tone}>
      <i>{symbol}</i>
      <span><strong>{count}</strong>{label}</span>
    </div>
  );
}

function DevelopmentDetails({ label, items }: {
  label: string;
  items: Array<{ id: string; title: string; meta: string; url: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <details className="development-details">
      <summary>{label}<span>{items.length}</span></summary>
      <div>
        {items.map((item) => (
          <button type="button" onClick={() => void openUrl(item.url)} key={item.id}>
            <span><strong>{item.title}</strong><small>{item.meta}</small></span>
            <b>열기</b>
          </button>
        ))}
      </div>
    </details>
  );
}

function formatDevelopmentStatus(value: string) {
  const labels: Record<string, string> = {
    open: "열림",
    closed: "닫힘",
    merged: "병합됨",
    completed: "완료",
    success: "성공",
    failure: "실패",
    in_progress: "진행 중",
    queued: "대기 중",
  };
  return labels[value.toLocaleLowerCase()] || value;
}

function TransitionCheckpoint({
  focusItem,
  destination,
  onCancel,
  onConfirm,
}: {
  focusItem: WorkItem;
  destination: string;
  onCancel: () => void;
  onConfirm: (checkpoint: string, nextAction: string) => Promise<void>;
}) {
  const [checkpoint, setCheckpoint] = useState(focusItem.checkpoint || "");
  const [nextAction, setNextAction] = useState(focusItem.nextAction || "");
  const [isSaving, setIsSaving] = useState(false);
  const isValid = checkpoint.trim().length > 0 && nextAction.trim().length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isValid) return;
    setIsSaving(true);
    try {
      await onConfirm(checkpoint, nextAction);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop checkpoint-backdrop">
      <form className="composer transition-checkpoint" onSubmit={submit}>
        <div className="transition-context">
          <span>작업 전환 전 체크포인트</span>
          <h2>{focusItem.title}</h2>
          <p><strong>{destination}</strong>(으)로 이동하기 전에 돌아올 지점을 남겨주세요.</p>
        </div>

        <label>
          현재까지 한 것 <em>필수</em>
          <textarea
            value={checkpoint}
            onChange={(event) => setCheckpoint(event.target.value)}
            placeholder="예: OAuth callback과 토큰 저장까지 구현함"
            autoFocus
          />
        </label>
        <label>
          돌아왔을 때 첫 번째 행동 <em>필수</em>
          <textarea
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
            placeholder="예: 저장된 토큰으로 PR API 호출하기"
          />
        </label>

        <div className="checkpoint-note">
          이 기록은 작업 상단에 표시되어 다음 시작점을 바로 알려줍니다.
        </div>
        <div className="composer-actions">
          <button type="button" onClick={onCancel}>계속 작업</button>
          <button className="primary-button" type="submit" disabled={!isValid || isSaving}>
            {isSaving ? "전환 중…" : "기록하고 전환"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
