import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Focus,
  GripVertical,
  ListPlus,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Repeat2,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { listCalendarEvents } from "../../entities/work-context/api/calendar-event-repository";
import {
  addDailyPriority,
  addWorkItemToDailyPlan,
  ensureTargetedWorkItemsInDailyPlan,
  listActivePlannedWorkItemIds,
  listDailyPlanRange,
  listDailyPriorities,
  removeDailyPriority,
  reorderDailyPriorities,
  replaceDailyPriority,
} from "../../entities/work-context/api/daily-plan-repository";
import {
  createPlannerCategory,
  createPlannerRoutine,
  deletePlannerCategory,
  deletePlannerRoutine,
  listPlannerCategories,
  listPlannerRoutines,
  materializePlannerRoutines,
} from "../../entities/work-context/api/planner-repository";
import { createWorkItem } from "../../entities/work-context/api/work-item-repository";
import { isSameDay, type CalendarEvent } from "../../entities/work-context/model/calendar-event";
import { localDateKey, reorderDailyPriorityIds, unplannedWorkItems, type DailyPlanEntry, type DailyPriority } from "../../entities/work-context/model/daily-plan";
import { monthGridDays, type PlannerCategory, type PlannerRoutine } from "../../entities/work-context/model/planner";
import type { WorkItem } from "../../entities/work-context/model/work-item";
import "./DashboardPage.scss";

const monthLabel = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" });
const selectedDateLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" });
const timeLabel = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const routineWeekdays = ["일", "월", "화", "수", "목", "금", "토"];
const categoryColors = ["#2F8FBF", "#D94B68", "#2B8C87", "#8B6DC7", "#D8893B", "#65804A"];

type ManagerKind = "category" | "routine" | "reminder" | null;

export default function DashboardPage({
  workItems,
  onResume,
  onComplete,
  onOpenContext,
  onChanged,
  onOpenDailyBriefing,
}: {
  workItems: WorkItem[];
  onResume: (item: WorkItem) => void;
  onComplete: (item: WorkItem) => void;
  onOpenContext: (item: WorkItem) => void;
  onChanged: () => Promise<void>;
  onOpenDailyBriefing: () => void;
}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [entries, setEntries] = useState<DailyPlanEntry[]>([]);
  const [priorities, setPriorities] = useState<DailyPriority[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<PlannerCategory[]>([]);
  const [routines, setRoutines] = useState<PlannerRoutine[]>([]);
  const [manager, setManager] = useState<ManagerKind>(null);
  const [isManagerMenuOpen, setIsManagerMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPriorityPickerOpen, setIsPriorityPickerOpen] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [plannedWorkItemIds, setPlannedWorkItemIds] = useState<string[]>([]);
  const [replacementCandidate, setReplacementCandidate] = useState<WorkItem | null>(null);
  const [draggedPriorityId, setDraggedPriorityId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [isPriorityDragOver, setIsPriorityDragOver] = useState(false);
  const [priorityAnnouncement, setPriorityAnnouncement] = useState("");
  const days = useMemo(() => monthGridDays(month), [month]);
  const rangeStart = localDateKey(days[0]);
  const rangeEnd = localDateKey(days[days.length - 1]);
  const selectedKey = localDateKey(selectedDate);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nextCategories, nextRoutines] = await Promise.all([listPlannerCategories(), listPlannerRoutines()]);
      await materializePlannerRoutines(rangeStart, rangeEnd);
      const nextPriorities = await listDailyPriorities(selectedKey);
      await ensureTargetedWorkItemsInDailyPlan(workItems, rangeStart, rangeEnd);
      for (const priority of nextPriorities) await addWorkItemToDailyPlan(priority.workItemId, selectedKey);
      const [nextEntries, nextEvents, nextPlannedWorkItemIds] = await Promise.all([
        listDailyPlanRange(rangeStart, rangeEnd),
        listCalendarEvents(days[0], new Date(days[days.length - 1].getFullYear(), days[days.length - 1].getMonth(), days[days.length - 1].getDate() + 1)),
        listActivePlannedWorkItemIds(),
      ]);
      setCategories(nextCategories);
      setRoutines(nextRoutines);
      setEntries(nextEntries);
      setEvents(nextEvents);
      setPriorities(nextPriorities);
      setPlannedWorkItemIds(nextPlannedWorkItemIds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, [rangeEnd, rangeStart, selectedKey, workItems]);

  useEffect(() => {
    setIsLoading(true);
    void refresh();
  }, [refresh]);

  const currentWorkItemById = new Map(workItems.map((item) => [item.id, item]));
  const selectedEntries = entries
    .filter((entry) => entry.planDate === selectedKey)
    .map((entry) => ({ ...entry, workItem: currentWorkItemById.get(entry.workItemId) || entry.workItem }));
  const currentPriorities = priorities.map((priority) => ({
    ...priority,
    workItem: currentWorkItemById.get(priority.workItemId) || priority.workItem,
  }));
  const priorityWorkItemIds = new Set(currentPriorities.map((priority) => priority.workItemId));
  const otherEntries = selectedEntries.filter((entry) => !priorityWorkItemIds.has(entry.workItemId));
  const availableTasks = unplannedWorkItems(workItems, plannedWorkItemIds);
  const priorityCandidates = workItems.filter((item) => item.status !== "done" && !priorityWorkItemIds.has(item.id));
  const selectedEvents = events.filter((event) => isSameDay(new Date(event.startAt), selectedDate));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const selectedCompleted = selectedEntries.filter((entry) => entry.workItem.status === "done").length;
  const reminders = workItems
    .filter((item) => item.targetAt && item.status !== "done")
    .sort((a, b) => new Date(a.targetAt!).getTime() - new Date(b.targetAt!).getTime());

  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(next);
  }

  function selectToday() {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  }

  async function createPlannedTask(input: { title: string; categoryId: string | null; targetAt: string | null }) {
    const id = await createWorkItem({ title: input.title, status: "todo", categoryId: input.categoryId, targetAt: input.targetAt });
    // A Planner item is a canonical Task first. Publish it to the app state
    // immediately so a later calendar-link failure cannot leave the board stale.
    await onChanged();
    await addWorkItemToDailyPlan(id, selectedKey);
    // Planner refresh may materialize routines and write to SQLite, so keep it
    // sequential with the app-wide read instead of running both concurrently.
    await refresh();
  }

  async function refreshPriorities() {
    setPriorities(await listDailyPriorities(selectedKey));
  }

  async function addPriority(item: WorkItem) {
    if (priorityWorkItemIds.has(item.id)) return;
    if (currentPriorities.length >= 3) {
      setReplacementCandidate(item);
      return;
    }
    try {
      await addWorkItemToDailyPlan(item.id, selectedKey);
      await addDailyPriority(selectedKey, item.id);
      await refresh();
      setIsPriorityPickerOpen(false);
      setPriorityAnnouncement(`${item.title}을(를) ${currentPriorities.length + 1}순위 핵심 작업으로 추가했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function removePriority(priority: DailyPriority) {
    try {
      await removeDailyPriority(priority.id);
      await refreshPriorities();
      setPriorityAnnouncement(`${priority.workItem.title}을(를) 핵심 작업에서 해제했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function replacePriority(priority: DailyPriority) {
    if (!replacementCandidate) return;
    try {
      const nextTitle = replacementCandidate.title;
      await addWorkItemToDailyPlan(replacementCandidate.id, selectedKey);
      await replaceDailyPriority(priority.id, replacementCandidate.id);
      setReplacementCandidate(null);
      setIsPriorityPickerOpen(false);
      await refresh();
      setPriorityAnnouncement(`${priority.rank}순위 핵심 작업을 ${nextTitle}(으)로 교체했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function addExistingTask(item: WorkItem) {
    try {
      await addWorkItemToDailyPlan(item.id, selectedKey);
      await refresh();
      setIsTaskPickerOpen(false);
      setPriorityAnnouncement(`${item.title}을(를) ${selectedDateLabel.format(selectedDate)} 계획에 추가했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function movePriority(sourceId: string, targetId: string) {
    const ids = currentPriorities.map((priority) => priority.id);
    const orderedIds = reorderDailyPriorityIds(ids, sourceId, targetId);
    if (orderedIds.every((id, index) => id === ids[index])) return;
    const byId = new Map(currentPriorities.map((priority) => [priority.id, priority]));
    setPriorities(orderedIds.flatMap((id, index) => {
      const priority = byId.get(id);
      return priority ? [{ ...priority, rank: index + 1 }] : [];
    }));
    try {
      await reorderDailyPriorities(selectedKey, orderedIds);
      const moved = byId.get(sourceId);
      setPriorityAnnouncement(`${moved?.workItem.title || "핵심 작업"}의 순서를 변경했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refreshPriorities();
    }
  }

  function shiftPriority(priorityId: string, direction: -1 | 1) {
    const index = currentPriorities.findIndex((priority) => priority.id === priorityId);
    const target = currentPriorities[index + direction];
    if (target) void movePriority(priorityId, target.id);
  }

  function dropTaskIntoPriorities(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsPriorityDragOver(false);
    if (!draggedTaskId || draggedPriorityId) return;
    const item = selectedEntries.find((entry) => entry.workItemId === draggedTaskId)?.workItem;
    setDraggedTaskId(null);
    if (item) void addPriority(item);
  }

  return (
    <main className="planner-page">
      <header className="planner-heading">
        <div className="planner-profile-mark"><Sparkles size={20} aria-hidden="true" /></div>
        <div className="planner-heading-copy">
          <span>ORBIT PLANNER</span>
          <h2>이번 달, 해야 할 일만 선명하게</h2>
          <p>업무와 생활을 계획하고 필요한 순간에만 Jira·Slack·AI 컨텍스트를 여세요.</p>
        </div>
        <div className="planner-heading-actions">
          <button className="planner-briefing-button" type="button" onClick={onOpenDailyBriefing}><Bot size={15} />오늘 브리핑</button>
          <button type="button" onClick={selectToday}>오늘</button>
          <div className="planner-manager-anchor">
            <button type="button" aria-label="플래너 관리 메뉴" aria-expanded={isManagerMenuOpen} onClick={() => setIsManagerMenuOpen((value) => !value)}><MoreHorizontal size={19} /></button>
            {isManagerMenuOpen && (
              <div className="planner-manager-menu">
                <button type="button" onClick={() => { setManager("category"); setIsManagerMenuOpen(false); }}><Settings2 size={15} />카테고리 관리</button>
                <button type="button" onClick={() => { setManager("routine"); setIsManagerMenuOpen(false); }}><Repeat2 size={15} />루틴 관리</button>
                <button type="button" onClick={() => { setManager("reminder"); setIsManagerMenuOpen(false); }}><AlarmClock size={15} />리마인더 관리</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && <div className="planner-error" role="alert">플래너를 불러오지 못했습니다. {error}</div>}

      <div className="planner-layout">
        <section className="planner-calendar" aria-label={`${monthLabel.format(month)} 월간 계획`}>
          <header className="planner-month-heading">
            <div>
              <button type="button" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
              <h3>{monthLabel.format(month)}</h3>
              <button type="button" aria-label="다음 달" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button>
            </div>
            <span>{entries.filter((entry) => entry.workItem.status === "done").length}개 완료</span>
          </header>
          <div className="planner-weekdays" aria-hidden="true">
            {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="planner-month-grid">
            {days.map((day) => {
              const key = localDateKey(day);
              const dayEntries = entries.filter((entry) => entry.planDate === key);
              const dayEvents = events.filter((event) => isSameDay(new Date(event.startAt), day));
              const isCurrentMonth = day.getMonth() === month.getMonth();
              const isToday = isSameDay(day, new Date());
              const isSelected = isSameDay(day, selectedDate);
              return (
                <button
                  className={`planner-day ${isCurrentMonth ? "" : "is-outside"} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  key={key}
                  aria-label={`${selectedDateLabel.format(day)}, 할 일 ${dayEntries.length}개, 일정 ${dayEvents.length}개`}
                  onClick={() => { setSelectedDate(day); if (!isCurrentMonth) setMonth(new Date(day.getFullYear(), day.getMonth(), 1)); }}
                >
                  <span className="planner-day-number">{day.getDate()}</span>
                  <div className="planner-day-items">
                    {dayEntries.slice(0, 3).map((entry) => {
                      const category = entry.workItem.categoryId ? categoryById.get(entry.workItem.categoryId) : undefined;
                      return <span className={entry.workItem.status === "done" ? "is-done" : ""} key={entry.id} style={{ "--item-color": category?.color || "var(--accent)" } as CSSProperties}><i />{entry.workItem.title}</span>;
                    })}
                    {dayEvents.slice(0, Math.max(0, 3 - dayEntries.length)).map((event) => <span className="is-event" key={event.id}><i />{event.title}</span>)}
                    {dayEntries.length + dayEvents.length > 3 && <small>+{dayEntries.length + dayEvents.length - 3}</small>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="planner-day-panel" aria-label={`${selectedDateLabel.format(selectedDate)} 계획`}>
          <div className="planner-category-strip">
            {categories.map((category) => (
              <span key={category.id} style={{ "--category-color": category.color } as CSSProperties}><i />{category.name}</span>
            ))}
            <button type="button" aria-label="카테고리 추가" onClick={() => setManager("category")}><Plus size={14} /></button>
          </div>

          <header className="planner-selected-heading">
            <div><span>{selectedDateLabel.format(selectedDate)}</span><h3>{selectedEntries.length ? `${selectedEntries.length}개의 계획` : "비어 있는 하루"}</h3></div>
            <em>{selectedEntries.length ? `${selectedCompleted}/${selectedEntries.length}` : "0"}</em>
          </header>

          <section
            className={`planner-priority-section ${isPriorityDragOver ? "is-drag-over" : ""}`}
            aria-label={`${isSameDay(selectedDate, new Date()) ? "오늘" : "이날"}의 핵심 작업, 최대 3개`}
            onDragOver={(event) => { event.preventDefault(); if (draggedTaskId && !draggedPriorityId) setIsPriorityDragOver(true); }}
            onDragLeave={() => setIsPriorityDragOver(false)}
            onDrop={dropTaskIntoPriorities}
          >
            <header className="planner-priority-heading">
              <div><Pin size={14} /><strong>{isSameDay(selectedDate, new Date()) ? "오늘의 핵심" : "이날의 핵심"}</strong></div>
              <span>{currentPriorities.length}/3</span>
            </header>
            <div className="planner-priority-list" role="list">
              {currentPriorities.map((priority, index) => {
                const item = priority.workItem;
                const category = item.categoryId ? categoryById.get(item.categoryId) : undefined;
                return (
                  <article
                    className={`planner-priority-card ${item.status === "done" ? "is-done" : ""} ${item.status === "focus" ? "is-focused" : ""} ${draggedPriorityId === priority.id ? "is-dragging" : ""}`}
                    draggable
                    key={priority.id}
                    role="listitem"
                    style={{ "--category-color": category?.color || "var(--accent)" } as CSSProperties}
                    onDragStart={() => { setDraggedPriorityId(priority.id); setDraggedTaskId(null); }}
                    onDragEnd={() => setDraggedPriorityId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); if (draggedPriorityId) void movePriority(draggedPriorityId, priority.id); setDraggedPriorityId(null); }}
                    onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                      event.preventDefault();
                      shiftPriority(priority.id, event.key === "ArrowUp" ? -1 : 1);
                    }}
                    tabIndex={0}
                  >
                    <GripVertical className="planner-priority-grip" size={15} aria-hidden="true" />
                    <span className="planner-priority-rank" aria-label={`${index + 1}순위`}>{index + 1}</span>
                    <button className="planner-priority-copy" type="button" onClick={() => onOpenContext(item)}><strong>{item.title}</strong><small>{category?.name || "미분류"}</small></button>
                    {item.status === "done" ? <span className="planner-priority-state"><Check size={14} /> 완료</span> : item.status === "focus" ? <span className="planner-priority-state is-active"><Focus size={14} /> 집중 중</span> : <button className="planner-focus-button" type="button" onClick={() => onResume(item)}><Focus size={14} /><span>집중</span></button>}
                    <div className="planner-priority-actions">
                      <button type="button" disabled={index === 0} aria-label={`${item.title} 위로 이동`} onClick={() => shiftPriority(priority.id, -1)}><ArrowUp size={13} /></button>
                      <button type="button" disabled={index === currentPriorities.length - 1} aria-label={`${item.title} 아래로 이동`} onClick={() => shiftPriority(priority.id, 1)}><ArrowDown size={13} /></button>
                      <button type="button" aria-label={`${item.title} 핵심에서 해제`} onClick={() => void removePriority(priority)}><PinOff size={13} /></button>
                    </div>
                  </article>
                );
              })}
              {currentPriorities.length < 3 && (
                <button className="planner-priority-slot" type="button" onClick={() => setIsPriorityPickerOpen(true)}><Plus size={14} /><span>핵심 할 일 선택</span></button>
              )}
            </div>
          </section>

          <p className="sr-only" aria-live="polite">{priorityAnnouncement}</p>

          <QuickTaskForm categories={categories} selectedDate={selectedDate} onSubmit={createPlannedTask} />
          <button className="planner-existing-task-button" type="button" onClick={() => setIsTaskPickerOpen(true)} disabled={availableTasks.length === 0}>
            <ListPlus size={15} /><span>기존 Task에서 추가</span><em>{availableTasks.length}</em>
          </button>

          <div className="planner-task-list">
            {otherEntries.length > 0 && <div className="planner-other-heading"><strong>다른 할 일</strong><span>{otherEntries.length}</span></div>}
            {otherEntries.map((entry) => {
              const category = entry.workItem.categoryId ? categoryById.get(entry.workItem.categoryId) : undefined;
              return (
                <article
                  className={entry.workItem.status === "done" ? "is-done" : ""}
                  draggable={entry.workItem.status !== "done"}
                  key={entry.id}
                  style={{ "--category-color": category?.color || "var(--accent)" } as CSSProperties}
                  onDragStart={() => { setDraggedTaskId(entry.workItemId); setDraggedPriorityId(null); }}
                  onDragEnd={() => { setDraggedTaskId(null); setIsPriorityDragOver(false); }}
                >
                  <button className="planner-task-check" type="button" disabled={entry.workItem.status === "done"} aria-label={entry.workItem.status === "done" ? `${entry.workItem.title} 완료됨` : `${entry.workItem.title} 완료`} onClick={() => onComplete(entry.workItem)}>{entry.workItem.status === "done" ? <Check size={14} /> : <Circle size={14} />}</button>
                  <button className="planner-task-copy" type="button" onClick={() => onOpenContext(entry.workItem)}>
                    <strong>{entry.workItem.title}</strong>
                    <small>{category?.name || "미분류"}{entry.workItem.targetAt ? ` · ${timeLabel.format(new Date(entry.workItem.targetAt))} 알림` : ""}</small>
                  </button>
                  {entry.workItem.status !== "done" && <div className="planner-task-actions"><button type="button" aria-label={`${entry.workItem.title} 핵심에 추가`} onClick={() => void addPriority(entry.workItem)}><Pin size={13} /></button><button className="planner-focus-button" type="button" onClick={() => onResume(entry.workItem)}><Focus size={14} /><span>집중</span></button></div>}
                </article>
              );
            })}
            {!isLoading && selectedEntries.length === 0 && <div className="planner-empty"><CalendarDays size={25} /><strong>아직 계획이 없어요</strong><span>새로 만들거나 기존 Task를 이 날짜에 추가하세요.</span></div>}
          </div>

          {selectedEvents.length > 0 && (
            <section className="planner-events">
              <header><strong>일정</strong><span>{selectedEvents.length}</span></header>
              {selectedEvents.map((event) => <div key={event.id}><i /><span><strong>{event.title}</strong><small>{event.allDay ? "종일" : timeLabel.format(new Date(event.startAt))}{event.location ? ` · ${event.location}` : ""}</small></span></div>)}
            </section>
          )}

          <div className="planner-context-note"><Sparkles size={15} /><span><strong>업무 컨텍스트는 작업 안에</strong><small>작업을 열면 Jira, PR, Slack, Codex·Claude 세션을 연결할 수 있어요.</small></span></div>
        </aside>
      </div>

      {manager === "category" && <CategoryManager categories={categories} onClose={() => setManager(null)} onChanged={refresh} />}
      {manager === "routine" && <RoutineManager categories={categories} routines={routines} rangeStart={rangeStart} rangeEnd={rangeEnd} onClose={() => setManager(null)} onChanged={async () => { await refresh(); await onChanged(); }} />}
      {manager === "reminder" && <ReminderManager reminders={reminders} onOpen={(item) => { setManager(null); onOpenContext(item); }} onClose={() => setManager(null)} />}
      {isPriorityPickerOpen && <PriorityPicker candidates={priorityCandidates} onSelect={(item) => void addPriority(item)} onClose={() => setIsPriorityPickerOpen(false)} />}
      {isTaskPickerOpen && <TaskPicker candidates={availableTasks} selectedDate={selectedDate} onSelect={(item) => void addExistingTask(item)} onClose={() => setIsTaskPickerOpen(false)} />}
      {replacementCandidate && <PriorityReplacement priorities={currentPriorities} candidate={replacementCandidate} onReplace={(priority) => void replacePriority(priority)} onClose={() => setReplacementCandidate(null)} />}
    </main>
  );
}

function TaskPicker({ candidates, selectedDate, onSelect, onClose }: { candidates: WorkItem[]; selectedDate: Date; onSelect: (item: WorkItem) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = candidates.filter((item) => !normalizedQuery || `${item.title} ${item.goal || ""}`.toLocaleLowerCase().includes(normalizedQuery));
  return (
    <ManagerShell title="기존 Task 추가" eyebrow="UNPLANNED TASKS" onClose={onClose}>
      <p className="planner-priority-dialog-copy">아직 날짜가 없는 미완료 Task를 <strong>{selectedDateLabel.format(selectedDate)}</strong> 계획에 배치합니다.</p>
      <input className="planner-task-picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Task 검색" autoFocus />
      <div className="planner-priority-picker">
        {filtered.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}><ListPlus size={15} /><span><strong>{item.title}</strong><small>{item.priority?.toUpperCase() || "우선순위 미지정"}</small></span><ChevronRight size={15} /></button>)}
        {filtered.length === 0 && <div className="planner-manager-empty">추가할 수 있는 Task가 없습니다.</div>}
      </div>
    </ManagerShell>
  );
}

function PriorityPicker({ candidates, onSelect, onClose }: { candidates: WorkItem[]; onSelect: (item: WorkItem) => void; onClose: () => void }) {
  return (
    <ManagerShell title="핵심 할 일 선택" eyebrow="TOP 3" onClose={onClose}>
      <p className="planner-priority-dialog-copy">이 날짜에 꼭 끝낼 작업을 최대 3개까지 고르세요.</p>
      <div className="planner-priority-picker">
        {candidates.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}><Pin size={15} /><span><strong>{item.title}</strong><small>오늘의 핵심에 추가</small></span><ChevronRight size={15} /></button>)}
        {candidates.length === 0 && <div className="planner-manager-empty">추가할 수 있는 미완료 할 일이 없습니다.</div>}
      </div>
    </ManagerShell>
  );
}

function PriorityReplacement({ priorities, candidate, onReplace, onClose }: { priorities: DailyPriority[]; candidate: WorkItem; onReplace: (priority: DailyPriority) => void; onClose: () => void }) {
  return (
    <ManagerShell title="핵심 작업 교체" eyebrow="TOP 3 FULL" onClose={onClose}>
      <p className="planner-priority-dialog-copy"><strong>{candidate.title}</strong>을(를) 추가하려면 기존 핵심 작업 하나를 선택해 교체하세요.</p>
      <div className="planner-priority-picker">
        {priorities.map((priority) => <button type="button" key={priority.id} onClick={() => onReplace(priority)}><span className="planner-priority-rank">{priority.rank}</span><span><strong>{priority.workItem.title}</strong><small>이 작업과 교체</small></span><ChevronRight size={15} /></button>)}
      </div>
    </ManagerShell>
  );
}

function QuickTaskForm({ categories, selectedDate, onSubmit }: {
  categories: PlannerCategory[];
  selectedDate: Date;
  onSubmit: (input: { title: string; categoryId: string | null; targetAt: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const dateKey = localDateKey(selectedDate);
      await onSubmit({
        title: title.trim(),
        categoryId: categoryId || null,
        targetAt: reminderTime ? new Date(`${dateKey}T${reminderTime}:00`).toISOString() : null,
      });
      setTitle("");
      setReminderTime("");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="planner-quick-form" onSubmit={submit}>
      <div><Plus size={16} /><input aria-label="할 일 제목" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="할 일을 입력하세요" /></div>
      <div className="planner-quick-options">
        <label><span className="sr-only">카테고리</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label><AlarmClock size={13} /><span className="sr-only">리마인더 시간</span><input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={!title.trim() || isSaving}>{isSaving ? "추가 중" : "추가"}</button>
      </div>
      {saveError && <p className="planner-quick-error" role="alert">{saveError}</p>}
    </form>
  );
}

function ManagerShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop planner-manager-backdrop" onMouseDown={onClose}><section className="planner-manager" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><span>{eyebrow}</span><h2>{title}</h2></div><button type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}

function CategoryManager({ categories, onClose, onChanged }: { categories: PlannerCategory[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(categoryColors[3]);
  const [message, setMessage] = useState<string | null>(null);
  return <ManagerShell title="카테고리 관리" eyebrow="PLANNER" onClose={onClose}>
    <form className="planner-manager-form" onSubmit={(event) => { event.preventDefault(); setMessage(null); void createPlannerCategory(name, color).then(async () => { setName(""); await onChanged(); }).catch((cause) => setMessage(String(cause))); }}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="새 카테고리 이름" autoFocus />
      <div className="planner-color-options">{categoryColors.map((candidate) => <button className={color === candidate ? "is-selected" : ""} type="button" aria-label={`${candidate} 색상`} key={candidate} style={{ background: candidate }} onClick={() => setColor(candidate)} />)}</div>
      <button className="primary-button" type="submit" disabled={!name.trim()}>등록</button>
    </form>
    <div className="planner-manager-list">{categories.map((category) => <div key={category.id}><i style={{ background: category.color }} /><span><strong>{category.name}</strong><small>{category.isSystem ? "기본 카테고리" : "사용자 카테고리"}</small></span>{!category.isSystem && <button type="button" aria-label={`${category.name} 삭제`} onClick={() => void deletePlannerCategory(category.id).then(() => onChanged()).catch((cause) => setMessage(String(cause)))}><Trash2 size={15} /></button>}</div>)}</div>
    {message && <p className="planner-manager-error">{message}</p>}
  </ManagerShell>;
}

function RoutineManager({ categories, routines, rangeStart, rangeEnd, onClose, onChanged }: { categories: PlannerCategory[]; routines: PlannerRoutine[]; rangeStart: string; rangeEnd: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [reminderTime, setReminderTime] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await createPlannerRoutine({ title, categoryId: categoryId || null, weekdays, reminderTime: reminderTime || null });
      await materializePlannerRoutines(rangeStart, rangeEnd);
      setTitle("");
      await onChanged();
    } catch (cause) { setMessage(String(cause)); }
  }
  return <ManagerShell title="루틴 관리" eyebrow="REPEAT" onClose={onClose}>
    <form className="planner-routine-form" onSubmit={(event) => void submit(event)}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 영어 단어 20개" autoFocus />
      <div className="planner-routine-fields"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><label><AlarmClock size={13} /><input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} /></label></div>
      <div className="planner-weekday-options">{routineWeekdays.map((label, day) => <button className={weekdays.includes(day) ? "is-selected" : ""} type="button" key={label} onClick={() => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])}>{label}</button>)}</div>
      <button className="primary-button" type="submit" disabled={!title.trim() || weekdays.length === 0}>루틴 등록</button>
    </form>
    <div className="planner-manager-list">{routines.map((routine) => <div key={routine.id}><Repeat2 size={16} /><span><strong>{routine.title}</strong><small>{routine.weekdays.map((day) => routineWeekdays[day]).join(" · ")}{routine.reminderTime ? ` · ${routine.reminderTime}` : ""}</small></span><button type="button" aria-label={`${routine.title} 삭제`} onClick={() => void deletePlannerRoutine(routine.id).then(() => onChanged()).catch((cause) => setMessage(String(cause)))}><Trash2 size={15} /></button></div>)}{routines.length === 0 && <div className="planner-manager-empty">등록한 루틴이 없습니다.</div>}</div>
    {message && <p className="planner-manager-error">{message}</p>}
  </ManagerShell>;
}

function ReminderManager({ reminders, onOpen, onClose }: { reminders: WorkItem[]; onOpen: (item: WorkItem) => void; onClose: () => void }) {
  return <ManagerShell title="리마인더 관리" eyebrow="REMINDER" onClose={onClose}><div className="planner-manager-list planner-reminder-list">{reminders.map((item) => <button type="button" key={item.id} onClick={() => onOpen(item)}><AlarmClock size={16} /><span><strong>{item.title}</strong><small>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.targetAt!))}</small></span><ChevronRight size={15} /></button>)}{reminders.length === 0 && <div className="planner-manager-empty">설정된 리마인더가 없습니다. 할 일을 추가할 때 시간을 선택해보세요.</div>}</div></ManagerShell>;
}
