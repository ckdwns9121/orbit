import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GitPullRequest,
  History,
  MapPin,
  RotateCcw,
  UserCheck,
} from "lucide-react";
import type { CalendarEvent } from "../domain/calendar-event";
import type { GitHubPullRequest } from "../domain/github-pull-request";
import { statusMeta, type WorkItem } from "../domain/work-item";
import {
  loadDashboardSnapshot,
  type DashboardSnapshot,
} from "../data/dashboard-repository";
import { buildContinuityDashboard, formatRelativeTime } from "../continuity/presenters";
import "./DashboardPage.scss";

const dayLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const eventTime = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });

export default function DashboardPage({
  workItems,
  onResume,
  onOpenContext,
  onOpenContinuity,
}: {
  workItems: WorkItem[];
  onResume: (item: WorkItem) => void;
  onOpenContext: (item: WorkItem) => void;
  onOpenContinuity: () => void;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <button className="dashboard-continuity-more" type="button" onClick={onOpenContinuity}>전체 업무 흐름 보기 <ArrowRight size={13} /></button>
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
