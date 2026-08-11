import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AlarmClock, Check, GripVertical, Link2, LockKeyhole, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { WorkItem, WorkItemStatus } from "../../../../entities/work-context/model/work-item";
import { statusMeta, workItemStatuses } from "../../../../entities/work-context/model/work-item";
import type { WorkItemSessionProgress } from "../../../../entities/work-context/api/ai-session-repository";
import { reorderWorkItemIds, sortWorkItems, type TaskSortMode } from "../../../../entities/work-context/model/work-item-sort";
import { taskBoardLaneForStatus, taskBoardLanes, type TaskBoardLane } from "../../../../entities/work-context/model/task-board";

const taskBoardLaneMeta: Record<TaskBoardLane, { label: string; description: string }> = {
  todo: { label: "할 일", description: "시작을 기다리는 모든 작업" },
  ai_running: { label: "진행 중", description: "현재 실행하고 있는 작업" },
  done: { label: "완료", description: "결과와 근거를 남긴 작업" },
};

function formatWorkItemCreatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function formatWorkItemTargetAt(value: string) {
  const target = new Date(value);
  const label = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(target);
  return `${target.getTime() <= Date.now() ? "목표 지남" : "목표"} ${label}`;
}

function TaskRow({
  item,
  progress,
  onMove,
  onRename,
  onOpenContext,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging = false,
  isFocusLocked = false,
  boardCard = false,
}: {
  item: WorkItem;
  progress?: WorkItemSessionProgress;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onOpenContext: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  onDragStart?: (event: DragEvent<HTMLElement>, item: WorkItem) => void;
  onDragOver?: (event: DragEvent<HTMLElement>, item: WorkItem) => void;
  onDrop?: (event: DragEvent<HTMLElement>, item: WorkItem) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isFocusLocked?: boolean;
  boardCard?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (boardCard && item.status === "focus") cardRef.current?.focus();
  }, [boardCard, item.id, item.status]);

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
    <article
      ref={cardRef}
      className={`task-row ${boardCard ? `task-board-card status-${item.status}` : ""} ${item.status === "review" ? "needs-review" : ""} ${onDragStart ? "is-sortable" : ""} ${isDragging ? "is-dragging" : ""} ${isFocusLocked ? "is-focus-locked" : ""}`}
      draggable={Boolean(onDragStart) && item.status !== "focus" && !isFocusLocked}
      inert={isFocusLocked ? true : undefined}
      aria-hidden={isFocusLocked ? true : undefined}
      tabIndex={boardCard ? 0 : undefined}
      aria-label={boardCard ? `${item.title}, ${statusMeta[item.status].label}.${item.status === "focus" ? " 다른 화면이 잠겨 있습니다. 집중 종료 또는 완료를 선택할 수 있습니다." : " 드래그하거나 Alt와 좌우 방향키로 상태를 이동할 수 있습니다."}` : undefined}
      onDragStart={onDragStart ? (event) => onDragStart(event, item) : undefined}
      onDragOver={onDragOver ? (event) => onDragOver(event, item) : undefined}
      onDrop={onDrop ? (event) => onDrop(event, item) : undefined}
      onDragEnd={onDragEnd}
      onKeyDown={boardCard ? (event) => {
        if (item.status === "focus") return;
        if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        const currentIndex = taskBoardLanes.indexOf(taskBoardLaneForStatus(item.status));
        const nextIndex = currentIndex + (event.key === "ArrowRight" ? 1 : -1);
        const nextStatus = taskBoardLanes[nextIndex];
        if (!nextStatus) return;
        event.preventDefault();
        void onMove(item.id, nextStatus);
      } : undefined}
    >
      <header className="task-card-header">
        <span className={`task-card-status ${item.status}`}><i aria-hidden="true" />{statusMeta[item.status].label}</span>
        <div className="task-card-header-actions" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsMenuOpen(false);
        }}>
          <span className="task-card-source">{item.source === "orbit" ? "LOCAL" : item.source.toUpperCase()}</span>
          <button type="button" aria-label={`${item.title} 작업 메뉴`} aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((current) => !current)}><MoreHorizontal size={16} /></button>
          {isMenuOpen && (
            <div className="task-card-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); onOpenContext(item); }}><Link2 size={13} /> 컨텍스트 보기</button>
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); setIsEditing(true); }}><Pencil size={13} /> 이름 수정</button>
              {item.status === "ai_running" && <>
                <div className="task-card-menu-divider" />
                <button className="focus-action" type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); void onMove(item.id, "focus"); }}><LockKeyhole size={13} /> 집중 시작</button>
              </>}
              {item.status !== "focus" && <>
              <div className="task-card-menu-divider" />
              {taskBoardLanes.filter((status) => status !== taskBoardLaneForStatus(item.status)).map((status) => (
                <button type="button" role="menuitem" key={status} onClick={() => { setIsMenuOpen(false); void onMove(item.id, status); }}>
                  <span className={`task-card-menu-dot ${status}`} /> {taskBoardLaneMeta[status].label}로 이동
                </button>
              ))}
              </>}
              {item.status !== "focus" && <><div className="task-card-menu-divider" />
                <button className="danger" type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); onDelete(item); }}><Trash2 size={13} /> 삭제</button></>}
            </div>
          )}
        </div>
      </header>
      <div className="task-copy">
        {isEditing ? (
          <form className="task-title-editor" onSubmit={submitTitle}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus aria-label="작업 이름" />
            <button className="task-title-save" type="submit" aria-label="작업 이름 저장"><Check size={14} strokeWidth={2} aria-hidden="true" /></button>
            <button type="button" aria-label="취소" onClick={() => { setTitle(item.title); setIsEditing(false); }}><X size={14} strokeWidth={2} aria-hidden="true" /></button>
          </form>
        ) : <strong onDoubleClick={() => setIsEditing(true)}>{item.title}</strong>}
        {(item.nextAction || item.goal) && <p className="task-card-summary">{item.nextAction || item.goal}</p>}
        {renameError && <small className="task-inline-error">{renameError}</small>}
      </div>
      <div className="task-card-meta">
        <span>생성 {formatWorkItemCreatedAt(item.createdAt)}</span>
        <span>{progress ? `AI 세션 ${progress.done}/${progress.total} 완료` : "연결된 AI 세션 없음"}</span>
      </div>
      {(item.priority || item.targetAt) && <div className="task-planning-meta">
        {item.priority && <small className={`task-priority-tag ${item.priority}`}>{item.priority.toUpperCase()}</small>}
        {item.targetAt && <small className={`task-target-time ${new Date(item.targetAt).getTime() <= Date.now() ? "is-overdue" : ""}`}><AlarmClock size={12} strokeWidth={1.8} aria-hidden="true" />{formatWorkItemTargetAt(item.targetAt)}</small>}
      </div>}
      {item.status === "focus" ? (
        <footer className="task-card-focus-actions">
          <button type="button" onClick={() => onOpenContext(item)}><Link2 size={13} /> 컨텍스트</button>
          <button type="button" onClick={() => { void onMove(item.id, "ai_running"); }}>집중 종료</button>
          <button className="primary-button" type="button" onClick={() => { void onMove(item.id, "done"); }}><Check size={13} /> 완료</button>
        </footer>
      ) : (
        <footer className="task-card-footer">
          <span className="task-card-drag-cue"><GripVertical size={14} strokeWidth={1.8} aria-hidden="true" /> 드래그해서 이동</span>
          <span>⌥ ← →</span>
        </footer>
      )}
    </article>
  );
}

export default function TaskBoard({
  items,
  isLoading,
  onMove,
  onRename,
  onOpenContext,
  onDelete,
  sessionProgress,
  onAdd,
  sortMode,
  onSortModeChange,
  onReorder,
}: {
  items: Record<WorkItemStatus, WorkItem[]>;
  isLoading: boolean;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onOpenContext: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  sessionProgress: Record<string, WorkItemSessionProgress>;
  onAdd: () => void;
  sortMode: TaskSortMode;
  onSortModeChange: (mode: TaskSortMode) => void;
  onReorder: (status: WorkItemStatus, orderedIds: string[]) => Promise<void>;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<TaskBoardLane | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskBoardLane | null>(null);
  const [isSortUnlockOpen, setIsSortUnlockOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const laneItems = useMemo(() => {
    const next: Record<TaskBoardLane, WorkItem[]> = { todo: [], ai_running: [], done: [] };
    workItemStatuses.forEach((status) => {
      items[status].forEach((item) => next[taskBoardLaneForStatus(item.status)].push(item));
    });
    return next;
  }, [items]);
  const sortedItems = useMemo(() => Object.fromEntries(
    taskBoardLanes.map((status) => {
      const sorted = sortWorkItems(laneItems[status], sortMode);
      if (status === "ai_running") {
        sorted.sort((left, right) => Number(right.status === "focus") - Number(left.status === "focus"));
      }
      return [status, sorted];
    }),
  ) as Record<TaskBoardLane, WorkItem[]>, [laneItems, sortMode]);
  const focusLocked = items.focus.length > 0;

  function startDrag(event: DragEvent<HTMLElement>, item: WorkItem) {
    const origin = event.target as HTMLElement;
    if (origin.closest("button, input, textarea, a")) {
      event.preventDefault();
      return;
    }
    if (sortMode !== "manual") {
      event.preventDefault();
      setIsSortUnlockOpen(true);
      return;
    }
    setDraggingId(item.id);
    setDraggingStatus(taskBoardLaneForStatus(item.status));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  }

  async function dropItem(event: DragEvent<HTMLElement>, status: TaskBoardLane, target?: WorkItem) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverStatus(null);
    if (!draggingId || !draggingStatus) return;

    const dragged = laneItems[draggingStatus].find((item) => item.id === draggingId);
    if (!dragged) return;

    if (draggingStatus !== status) {
      setAnnouncement(`${dragged.title}을 ${taskBoardLaneMeta[status].label}로 이동합니다.`);
      setDraggingId(null);
      setDraggingStatus(null);
      await onMove(dragged.id, status);
      return;
    }

    if (!target || draggingId === target.id) {
      setDraggingId(null);
      setDraggingStatus(null);
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const placeAfter = event.clientY > bounds.top + bounds.height / 2;
    const orderedIds = reorderWorkItemIds(sortedItems[status].map(({ id }) => id), draggingId, target.id, placeAfter);
    setDraggingId(null);
    setDraggingStatus(null);
    setAnnouncement(`${dragged.title}의 순서를 변경했습니다.`);
    await onReorder(dragged.status, orderedIds.filter((id) => laneItems[status].some((item) => item.id === id && item.status === dragged.status)));
  }

  function finishDrag() {
    setDraggingId(null);
    setDraggingStatus(null);
    setDragOverStatus(null);
  }

  return (
    <>
    <section className={`task-board-page ${focusLocked ? "is-focus-locked" : ""}`} aria-label="Task 보드">
      <header className="task-board-toolbar" inert={focusLocked ? true : undefined} aria-hidden={focusLocked ? true : undefined}>
        <div>
          <h2>작업 보드</h2>
          <p>카드를 세로로 확인하고 다른 열로 드래그해 상태를 바꿀 수 있어요.</p>
        </div>
        <div className="task-sort-actions">
          <span>{items.todo.length + items.focus.length + items.ai_running.length + items.review.length + items.blocked.length + items.inbox.length + items.done.length}개</span>
          <label>
            <span className="sr-only">Task 정렬 방식</span>
            <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as TaskSortMode)}>
              <option value="manual">수동 정렬</option>
              <option value="newest">최신 생성순</option>
              <option value="oldest">오래된 생성순</option>
            </select>
          </label>
        </div>
      </header>

      {isLoading ? (
        <div className="empty-state">작업을 불러오는 중…</div>
      ) : (
        <div className="task-board-scroll">
          <div className="task-board">
            {taskBoardLanes.map((status) => {
              const isLockedColumn = focusLocked && status !== "ai_running";
              const isFocusColumn = focusLocked && status === "ai_running";
              return (
              <section
                className={`task-board-column task-board-column-${status} ${isFocusColumn ? "is-focus-column" : ""} ${isLockedColumn ? "is-locked" : ""} ${dragOverStatus === status ? "is-drag-over" : ""}`}
                key={status}
                aria-labelledby={`task-column-${status}`}
                inert={isLockedColumn ? true : undefined}
                aria-hidden={isLockedColumn ? true : undefined}
                onDragOver={(event) => {
                  if (!draggingId || isLockedColumn) return;
                  event.preventDefault();
                  setDragOverStatus(status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverStatus(null);
                }}
                onDrop={(event) => { void dropItem(event, status); }}
              >
                <header className="task-board-column-header">
                  <div>
                    <span className={`task-board-status-dot ${status}`} aria-hidden="true" />
                    <div>
                      <h3 id={`task-column-${status}`}>{taskBoardLaneMeta[status].label}</h3>
                      <p>{taskBoardLaneMeta[status].description}</p>
                    </div>
                  </div>
                  <span className="task-board-count" aria-label={`${laneItems[status].length}개`}>{laneItems[status].length}</span>
                </header>

                {isFocusColumn && (
                  <div className="focus-lock-banner" role="status"><LockKeyhole size={14} /> 현재 한 작업에 집중 중</div>
                )}

                <div className="task-board-list">
                  {sortedItems[status].map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      progress={sessionProgress[item.id]}
                      onMove={onMove}
                      onRename={onRename}
                      onOpenContext={onOpenContext}
                      onDelete={onDelete}
                      onDragStart={startDrag}
                      onDragOver={(event) => { if (draggingId) event.preventDefault(); }}
                      onDrop={(event, target) => { void dropItem(event, status, target); }}
                      onDragEnd={finishDrag}
                      isDragging={draggingId === item.id}
                      isFocusLocked={focusLocked && item.id !== items.focus[0]?.id}
                      boardCard
                    />
                  ))}
                  {sortedItems[status].length === 0 && (
                    <div className="task-board-empty">
                      <strong>{taskBoardLaneMeta[status].label} 작업이 없습니다</strong>
                      <span>{status === "todo" ? "새 작업을 추가하거나 카드를 여기로 옮겨보세요." : "다른 열의 카드를 여기로 옮겨보세요."}</span>
                      {status === "todo" && <button type="button" onClick={onAdd}><Plus size={13} /> 작업 추가</button>}
                    </div>
                  )}
                </div>
              </section>
              );
            })}
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{focusLocked ? `${items.focus[0]?.title} 작업에 집중 중입니다. 다른 화면은 잠겼습니다.` : announcement}</p>
    </section>
    {isSortUnlockOpen && (
      <div className="modal-backdrop" onMouseDown={() => setIsSortUnlockOpen(false)}>
        <section className="sort-unlock-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="sort-unlock-icon"><GripVertical size={18} strokeWidth={1.8} /></div>
          <h2>정렬을 해제하시겠습니까?</h2>
          <p>현재 날짜순으로 정렬되어 있습니다. 드래그로 순서를 바꾸려면 수동 정렬로 전환해야 합니다.</p>
          <div>
            <button type="button" onClick={() => setIsSortUnlockOpen(false)}>아니요</button>
            <button className="primary-button" type="button" onClick={() => { onSortModeChange("manual"); setIsSortUnlockOpen(false); }}>예, 정렬 해제</button>
          </div>
        </section>
      </div>
    )}
    </>
  );
}
