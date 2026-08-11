import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GitPullRequest,
  GripVertical,
  History,
  MapPin,
  Plus,
  RotateCcw,
  UserCheck,
} from "lucide-react";
import type { CalendarEvent } from "../../entities/work-context/model/calendar-event";
import type { GitHubPullRequest } from "../../entities/work-context/model/github-pull-request";
import { statusMeta, type WorkItem } from "../../entities/work-context/model/work-item";
import {
  loadDashboardSnapshot,
  type DashboardSnapshot,
} from "../../entities/work-context/api/dashboard-repository";
import { buildContinuityDashboard, formatRelativeTime } from "../../features/tasks/work-continuity";
import { createWorkItem } from "../../entities/work-context/api/work-item-repository";
import { addWorkItemToDailyPlan, carryDailyPlanEntry, listDailyPlan, reorderDailyPlanEntries } from "../../entities/work-context/api/daily-plan-repository";
import { addLocalDays, localDateKey, reorderDailyPlanEntries as moveDailyPlanEntryInList, type DailyPlanEntry } from "../../entities/work-context/model/daily-plan";
import "./DashboardPage.scss";

const dayLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const eventTime = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

export default function DashboardPage({
  workItems,
  onResume,
  onOpenContext,
  onChanged,
}: {
  workItems: WorkItem[];
  onResume: (item: WorkItem) => void;
  onOpenContext: (item: WorkItem) => void;
  onChanged: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState(() => localDateKey(new Date()));
  const [planEntries, setPlanEntries] = useState<DailyPlanEntry[]>([]);
  const [quickTitle, setQuickTitle] = useState("");
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [isSavingPlanOrder, setIsSavingPlanOrder] = useState(false);
  const [isAddingQuickTask, setIsAddingQuickTask] = useState(false);
  const completedCount = useMemo(() => planEntries.filter((entry) => entry.workItem.status === "done").length, [planEntries]);

  async function refreshPlan(date = planDate) {
    setPlanEntries(await listDailyPlan(date));
    setDraggedEntryId(null);
    setDropTargetId(null);
  }

  async function savePlanOrder(nextEntries: DailyPlanEntry[], previousEntries: DailyPlanEntry[]) {
    setPlanEntries(nextEntries);
    setPlanError(null);
    setIsSavingPlanOrder(true);
    try {
      await reorderDailyPlanEntries(planDate, nextEntries.map((entry) => entry.id));
    } catch (cause) {
      setPlanEntries(previousEntries);
      setPlanError(`순서를 저장하지 못했습니다. ${cause instanceof Error ? cause.message : String(cause)}`);
      void refreshPlan();
    } finally {
      setIsSavingPlanOrder(false);
    }
  }

  function movePlanEntry(entryId: string, targetId: string) {
    if (isSavingPlanOrder || entryId === targetId) return;
    const previousEntries = planEntries;
    const nextEntries = moveDailyPlanEntryInList(previousEntries, entryId, targetId);
    if (nextEntries === previousEntries) return;
    void savePlanOrder(nextEntries, previousEntries);
  }

  function movePlanEntryByOffset(entryId: string, offset: number) {
    const from = planEntries.findIndex((entry) => entry.id === entryId);
    const to = Math.max(0, Math.min(planEntries.length - 1, from + offset));
    if (from < 0 || from === to) return;
    movePlanEntry(entryId, planEntries[to].id);
  }

  useEffect(() => {
    setPlanError(null);
    void refreshPlan().catch((cause) => setPlanError(`계획을 불러오지 못했습니다. ${cause instanceof Error ? cause.message : String(cause)}`));
  }, [planDate]);

  async function addQuickTask() {
    const title = quickTitle.trim();
    if (!title || isAddingQuickTask) return;
    setIsAddingQuickTask(true);
    setPlanError(null);
    try {
      const id = await createWorkItem({ title, status: "todo" });
      await addWorkItemToDailyPlan(id, planDate);
      setQuickTitle("");
      await Promise.all([refreshPlan(), onChanged()]);
    } catch (cause) {
      setPlanError(`할 일을 추가하지 못했습니다. ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setIsAddingQuickTask(false);
    }
  }

  useEffect(() => {
    let active = true;
    setError(null);
    void loadDashboardSnapshot()
      .then((next) => active && setSnapshot(next))
      .catch((cause) => active && setError(String(cause)));
    return () => { active = false; };
  }, []);

  if (error) return <div className="dashboard-error">대시보드를 불러오지 못했습니다. {error}</div>;
  if (!snapshot) return <div className="dashboard-loading">오늘의 업무를 불러오는 중…</div>;
  const continuity = buildContinuityDashboard(workItems);

  return (
    <main className="dashboard-page">
      <header className="dashboard-heading">
        <span className="dashboard-eyebrow">TODAY</span>
        <h2>오늘의 업무</h2>
        <p>{dayLabel.format(new Date())} · 먼저 확인해야 할 작업과 리뷰를 모았어요.</p>
      </header>

      <section className="daily-planner" aria-label="일일 계획">
        <header className="daily-planner-header">
          <button type="button" aria-label="이전 날짜" disabled={isSavingPlanOrder} onClick={() => setPlanDate(addLocalDays(planDate, -1))}><ChevronLeft size={17} /></button>
          <div>
            <strong>{dayLabel.format(new Date(`${planDate}T12:00:00`))}</strong>
            <span>{completedCount}/{planEntries.length} 완료</span>
          </div>
          <button type="button" aria-label="다음 날짜" disabled={isSavingPlanOrder} onClick={() => setPlanDate(addLocalDays(planDate, 1))}><ChevronRight size={17} /></button>
        </header>
        <div className="daily-planner-progress" role="progressbar" aria-label="일일 계획 완료율" aria-valuemin={0} aria-valuemax={planEntries.length} aria-valuenow={completedCount}><i style={{ width: `${planEntries.length ? (completedCount / planEntries.length) * 100 : 0}%` }} /></div>
        <form className="daily-quick-add" onSubmit={(event) => { event.preventDefault(); void addQuickTask(); }}>
          <Plus size={16} />
          <input aria-label="일일 계획에 할 일 추가" value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="이 날짜에 할 일을 빠르게 추가하세요" />
          <button type="submit" disabled={!quickTitle.trim() || isAddingQuickTask}>{isAddingQuickTask ? "추가 중…" : "추가"}</button>
        </form>
        <p className="daily-plan-hint">카드를 끌어 순서를 바꾸거나, 핸들에 포커스한 뒤 ⌥ + ↑ / ↓ 로 이동할 수 있어요.</p>
        <div className="daily-plan-list">
          {planEntries.map((entry) => (
            <article
              className={`daily-plan-row ${entry.workItem.status === "done" ? "is-done" : ""} ${draggedEntryId === entry.id ? "is-dragging" : ""} ${dropTargetId === entry.id ? "is-drop-target" : ""}`}
              key={entry.id}
              onDragOver={(event) => { event.preventDefault(); if (draggedEntryId && draggedEntryId !== entry.id) setDropTargetId(entry.id); }}
              onDragLeave={(event) => {
                if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null) && dropTargetId === entry.id) {
                  setDropTargetId(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedEntryId) movePlanEntry(draggedEntryId, entry.id);
                setDraggedEntryId(null);
                setDropTargetId(null);
              }}
            >
              <button
                className="daily-plan-drag-handle"
                type="button"
                draggable={planEntries.length > 1 && !isSavingPlanOrder}
                disabled={isSavingPlanOrder}
                aria-label={`${entry.workItem.title} 순서 변경. Alt와 위아래 화살표로 이동`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", entry.id);
                  setDraggedEntryId(entry.id);
                }}
                onDragEnd={() => { setDraggedEntryId(null); setDropTargetId(null); }}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                  event.preventDefault();
                  movePlanEntryByOffset(entry.id, event.key === "ArrowUp" ? -1 : 1);
                }}
              ><GripVertical size={15} aria-hidden="true" /></button>
              <button className="daily-plan-check" type="button" aria-label={`${entry.workItem.title} 열기`} onClick={() => onOpenContext(entry.workItem)}>{entry.workItem.status === "done" ? <CheckCircle2 size={17} /> : <span />}</button>
              <button className="daily-plan-copy" type="button" onClick={() => onOpenContext(entry.workItem)}><strong>{entry.workItem.title}</strong><small>{entry.workItem.nextAction || statusMeta[entry.workItem.status].label}</small></button>
              {entry.workItem.status !== "done" && <button type="button" onClick={() => onResume(entry.workItem)}>시작</button>}
              {entry.workItem.status !== "done" && <button type="button" onClick={() => {
                setPlanError(null);
                void carryDailyPlanEntry(entry, addLocalDays(planDate, 1))
                  .then(() => refreshPlan())
                  .catch((cause) => setPlanError(`내일로 옮기지 못했습니다. ${cause instanceof Error ? cause.message : String(cause)}`));
              }}>내일</button>}
            </article>
          ))}
          {!planEntries.length && <div className="dashboard-empty">이 날짜에 계획한 작업이 없습니다.</div>}
        </div>
        {isSavingPlanOrder && !planError && <p className="daily-plan-hint" aria-live="polite">순서를 저장하는 중…</p>}
        {planError && <p className="daily-plan-error" role="alert">{planError}</p>}
      </section>

      <section className="dashboard-continuity" aria-label="작업 이어가기">
        <article className="dashboard-resume-card">
          <header><div><RotateCcw size={15} /><strong>이어서 시작</strong></div><span>{continuity.resume ? formatRelativeTime(continuity.resume.pausedAt || continuity.resume.lastFocusedAt || continuity.resume.updatedAt) : "추천"}</span></header>
          {continuity.resume ? (
            <div className="dashboard-resume-body">
              <div>
                <h3>{continuity.resume.title}</h3>
                <p>{continuity.resume.checkpoint || "마지막 체크포인트가 없습니다."}</p>
                <small><ArrowRight size={12} /> {continuity.resume.nextAction || "재개 후 첫 행동을 정해보세요."}</small>
              </div>
              <div className="dashboard-resume-actions">
                <button type="button" onClick={() => onOpenContext(continuity.resume!)}>근거 보기</button>
                <button className="primary-button" type="button" onClick={() => onResume(continuity.resume!)}>재개</button>
              </div>
            </div>
          ) : (
            <div className="dashboard-continuity-empty">멈춰 둔 작업이 없습니다. 오늘 작업에서 다음 실행 항목을 선택해보세요.</div>
          )}
        </article>

        <article className="dashboard-continuity-queue">
          <header><div><AlertTriangle size={15} /><strong>막힌 작업 재점검</strong></div><span>{continuity.blocked.length}개</span></header>
          {continuity.blocked.slice(0, 2).map((item) => (
            <button type="button" key={item.id} onClick={() => onOpenContext(item)}>
              <span><strong>{item.title}</strong><small>{item.blockedReason || "막힌 이유가 기록되지 않았습니다."}</small></span>
              <ArrowRight size={13} />
            </button>
          ))}
          {!continuity.blocked.length && <div className="dashboard-queue-empty">지금 재점검할 막힌 작업이 없습니다.</div>}
        </article>

        <article className="dashboard-continuity-queue">
          <header><div><History size={15} /><strong>방치 작업</strong></div><span>{continuity.forgotten.length}개</span></header>
          {continuity.forgotten.slice(0, 2).map((item) => (
            <button type="button" key={item.id} onClick={() => onOpenContext(item)}>
              <span><strong>{item.title}</strong><small>{formatRelativeTime(item.updatedAt)} 이후 진전 없음</small></span>
              <ArrowRight size={13} />
            </button>
          ))}
          {!continuity.forgotten.length && <div className="dashboard-queue-empty">7일 이상 멈춘 작업이 없습니다.</div>}
        </article>
      </section>

      <section className="dashboard-work-grid" aria-label="오늘의 업무 현황">
        <TaskPanel
          icon={Clock3}
          title="오늘 작업"
          meta={`${snapshot.todayTasks.length}개`}
          tasks={snapshot.todayTasks}
          empty="오늘 예정된 작업이 없습니다."
        />
        <TaskPanel
          icon={CheckCircle2}
          title="어제 한 작업"
          meta={`${snapshot.yesterdayTasks.length}개 완료`}
          tasks={snapshot.yesterdayTasks}
          empty="어제 완료한 작업이 없습니다."
          completed
        />
        <PullRequestPanel
          icon={GitPullRequest}
          title="열린 PR"
          meta={`${snapshot.openPullRequests.length}개`}
          pullRequests={snapshot.openPullRequests}
          empty="내가 올린 열린 PR이 없습니다."
        />
        <PullRequestPanel
          icon={UserCheck}
          title="내 리뷰 대기 PR"
          meta={`${snapshot.reviewRequests.length}개`}
          pullRequests={snapshot.reviewRequests}
          empty="내 리뷰를 기다리는 PR이 없습니다."
          review
        />
      </section>

      <section className="dashboard-schedule" aria-label="오늘 일정">
        <PanelHeading icon={CalendarDays} title="오늘 일정" meta={`${snapshot.todayEvents.length}개`} />
        {snapshot.todayEvents.length ? (
          <div className="dashboard-event-list">
            {snapshot.todayEvents.map((event) => <EventRow event={event} key={event.id} />)}
          </div>
        ) : <Empty text="오늘 등록된 일정이 없습니다." />}
      </section>
    </main>
  );
}

function TaskPanel({
  icon: Icon,
  title,
  meta,
  tasks,
  empty,
  completed = false,
}: {
  icon: typeof Clock3;
  title: string;
  meta: string;
  tasks: WorkItem[];
  empty: string;
  completed?: boolean;
}) {
  return (
    <article className="dashboard-panel dashboard-task-panel">
      <PanelHeading icon={Icon} title={title} meta={meta} />
      {tasks.length ? (
        <div className="dashboard-list">
          {tasks.slice(0, 3).map((task) => (
            <div className="dashboard-task-row" key={task.id}>
              <span className={`dashboard-task-check ${completed ? "is-complete" : ""}`}>
                {completed && <CheckCircle2 size={14} />}
              </span>
              <div>
                <strong>{task.title}</strong>
                <small>{task.nextAction || task.checkpoint || (completed ? "완료됨" : "다음 행동을 정해보세요")}</small>
              </div>
              <em>{completed ? "완료" : statusMeta[task.status].shortLabel}</em>
            </div>
          ))}
        </div>
      ) : <Empty text={empty} />}
    </article>
  );
}

function PullRequestPanel({
  icon: Icon,
  title,
  meta,
  pullRequests,
  empty,
  review = false,
}: {
  icon: typeof GitPullRequest;
  title: string;
  meta: string;
  pullRequests: GitHubPullRequest[];
  empty: string;
  review?: boolean;
}) {
  return (
    <article className="dashboard-panel dashboard-pr-panel">
      <PanelHeading icon={Icon} title={title} meta={meta} />
      {pullRequests.length ? (
        <div className="dashboard-list">
          {pullRequests.slice(0, 3).map((pullRequest) => (
            <button className="dashboard-pr-row" key={`${pullRequest.repository}:${pullRequest.number}`} type="button" onClick={() => void openUrl(pullRequest.url)}>
              <span className="dashboard-pr-mark"><GitPullRequest size={14} /></span>
              <div>
                <strong>{pullRequest.title}</strong>
                <small>{pullRequest.repository} · #{pullRequest.number}</small>
              </div>
              <em>{review ? "리뷰 필요" : pullRequest.isDraft ? "Draft" : "Open"}</em>
            </button>
          ))}
        </div>
      ) : <Empty text={empty} />}
    </article>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const content = (
    <>
      <time>{event.allDay ? "종일" : eventTime.format(new Date(event.startAt))}</time>
      <div>
        <strong>{event.title}</strong>
        <small>{event.location ? <><MapPin size={11} /> {event.location}</> : event.source === "google" ? "Google Calendar" : "Orbit 일정"}</small>
      </div>
      <span>{event.allDay ? "하루 종일" : `${eventTime.format(new Date(event.endAt))}까지`}</span>
    </>
  );
  return event.externalUrl
    ? <button className="dashboard-event-row" type="button" onClick={() => void openUrl(event.externalUrl!)}>{content}</button>
    : <div className="dashboard-event-row">{content}</div>;
}

function PanelHeading({ icon: Icon, title, meta }: { icon: typeof CalendarDays; title: string; meta: string }) {
  return <header className="dashboard-panel-heading"><div><Icon size={16} strokeWidth={1.8} /><h3>{title}</h3></div><span>{meta}</span></header>;
}

function Empty({ text }: { text: string }) { return <div className="dashboard-empty">{text}</div>; }
