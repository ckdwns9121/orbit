import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import "./App.scss";
import {
  createWorkItem,
  listWorkItems,
  moveWorkItem,
  updateCheckpoint,
} from "./data/work-item-repository";
import {
  statusMeta,
  workItemStatuses,
  type WorkItem,
  type WorkItemStatus,
} from "./domain/work-item";
import { requiresCheckpoint, type WorkItemTransition } from "./domain/workflow";
import CalendarPage from "./calendar/CalendarPage";
import SettingsPage from "./settings/SettingsPage";

type PrimarySection = "tasks" | "calendar" | "settings";
type TaskTab = "today" | Exclude<WorkItemStatus, "focus">;

const taskTabs: Array<{ id: TaskTab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "inbox", label: "Inbox" },
  { id: "todo", label: "할 일" },
  { id: "ai_running", label: "AI 작업 중" },
  { id: "review", label: "내 확인 필요" },
  { id: "blocked", label: "막힘" },
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
  const [pendingTransition, setPendingTransition] = useState<WorkItemTransition | null>(null);
  const [activeSection, setActiveSection] = useState<PrimarySection>("tasks");
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>("today");

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setItems(await listWorkItems());
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
            <h1>{activeSection === "tasks" ? "Task" : activeSection === "calendar" ? "Calendar" : "Settings"}</h1>
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

        {activeSection === "calendar" ? (
          <CalendarPage />
        ) : activeSection === "settings" ? (
          <SettingsPage />
        ) : (
          <>
        {error && (
          <div className="error-banner">
            SQLite 연결에 실패했습니다. Tauri 앱에서 실행했는지 확인해주세요.
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
                  <TaskRow key={item.id} item={item} onMove={handleMove} />
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
                <TaskRow key={item.id} item={item} onMove={handleMove} />
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
            onAdd={() => setIsComposerOpen(true)}
          />
        )}
          </>
        )}
      </main>

      {isComposerOpen && (
        <TaskComposer
          allowFocus={!focusItem}
          initialStatus={
            activeTaskTab === "today" || activeTaskTab === "done"
              ? "todo"
              : activeTaskTab
          }
          onClose={() => setIsComposerOpen(false)}
          onCreated={async () => {
            setIsComposerOpen(false);
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
  onMove,
}: {
  item: WorkItem;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
}) {
  return (
    <article className={`task-row ${item.status === "review" ? "needs-review" : ""}`}>
      <button
        className="check-button"
        type="button"
        aria-label={`${item.title} 완료`}
        onClick={() => onMove(item.id, "done")}
      />
      <span className={`priority ${item.priority || ""}`}>{item.priority?.toUpperCase() || "·"}</span>
      <div className="task-copy">
        <strong>{item.title}</strong>
        <span>{item.nextAction || item.goal || `${statusMeta[item.status].label} · 로컬 작업`}</span>
      </div>
      <select value={item.status} onChange={(event) => onMove(item.id, event.target.value as WorkItemStatus)}>
        {workItemStatuses.map((status) => (
          <option value={status} key={status}>{statusMeta[status].label}</option>
        ))}
      </select>
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
  onAdd,
}: {
  status: Exclude<WorkItemStatus, "focus">;
  items: WorkItem[];
  isLoading: boolean;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onAdd: () => void;
}) {
  const descriptions: Record<Exclude<WorkItemStatus, "focus">, string> = {
    inbox: "아직 분류하지 않은 작업",
    todo: "실행할 준비가 된 작업",
    ai_running: "AI가 처리하고 있어 기다리는 작업",
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
          {items.map((item) => <TaskRow key={item.id} item={item} onMove={onMove} />)}
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

function TaskComposer({
  allowFocus,
  initialStatus,
  onClose,
  onCreated,
}: {
  allowFocus: boolean;
  initialStatus: WorkItemStatus;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<WorkItemStatus>(initialStatus);
  const [nextAction, setNextAction] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await createWorkItem({ title, status, nextAction });
      await onCreated();
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
          <div><span>새 로컬 작업</span><h2>무엇을 해야 하나요?</h2></div>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <label>작업 제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: GitHub OAuth callback 구현" autoFocus /></label>
        <label>다음 행동<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="돌아왔을 때 바로 실행할 한 단계" /></label>
        <label>시작 상태<select value={status} onChange={(event) => setStatus(event.target.value as WorkItemStatus)}>
          <option value="todo">할 일</option>
          <option value="focus" disabled={!allowFocus}>지금 집중 중{allowFocus ? "" : " · 기존 작업 먼저 전환"}</option>
          <option value="ai_running">AI 작업 중</option>
          <option value="review">내 확인 필요</option>
          <option value="inbox">Inbox</option>
        </select></label>
        {saveError && <div className="composer-error" role="alert">저장하지 못했습니다. <small>{saveError}</small></div>}
        <div className="composer-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button className="primary-button" type="submit" disabled={isSaving || !title.trim()}>{isSaving ? "저장 중…" : "작업 추가"}</button>
        </div>
      </form>
    </div>
  );
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
