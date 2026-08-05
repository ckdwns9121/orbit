import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadDashboardSnapshot, type DashboardSnapshot } from "../data/dashboard-repository";
import "./DashboardPage.scss";

const time = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void loadDashboardSnapshot().then(setSnapshot).catch((cause) => setError(String(cause))); }, []);
  if (error) return <div className="dashboard-error">대시보드를 불러오지 못했습니다. {error}</div>;
  if (!snapshot) return <div className="dashboard-loading">오늘의 업무를 모으는 중…</div>;

  return <div className="dashboard-page">
    <section className="dashboard-hero"><div><span>TODAY</span><h2>오늘의 실행과 성과</h2><p>Orbit에 연결된 업무 기록을 기준으로 정리했습니다.</p></div><div className="dashboard-stats"><Metric value={snapshot.currentTasks.length} label="현재 작업" /><Metric value={snapshot.todayEvents.length} label="오늘 일정" /><Metric value={snapshot.todayCommits.length} label="오늘 커밋" /><Metric value={snapshot.todayCompleted.length} label="오늘 완료" /></div></section>
    <div className="dashboard-grid">
      <DashboardCard title="오늘 할 일" meta={`${snapshot.currentTasks.length}개`}>
        {snapshot.currentTasks.length ? snapshot.currentTasks.map((task) => <div className="dashboard-task" key={task.id}><i className={`status-${task.status}`} /><div><strong>{task.title}</strong><small>{task.nextAction || task.checkpoint || "다음 액션 미기록"}</small></div><span>{statusLabel(task.status)}</span></div>) : <Empty text="진행할 작업이 없습니다." />}
      </DashboardCard>
      <DashboardCard title="오늘 일정" meta={`${snapshot.todayEvents.length}개`}>
        {snapshot.todayEvents.length ? snapshot.todayEvents.map((event) => <button className="dashboard-event" type="button" key={event.id} onClick={() => event.externalUrl && void openUrl(event.externalUrl)}><time>{event.allDay ? "종일" : time.format(new Date(event.startAt))}</time><div><strong>{event.title}</strong><small>{event.location || (event.source === "google" ? "Google Calendar" : "Orbit")}</small></div></button>) : <Empty text="오늘 일정이 없습니다." />}
      </DashboardCard>
      <DashboardCard title="어제 회고" meta={`${snapshot.yesterdayCompleted.length}개 완료`}>
        {snapshot.yesterdayCompleted.length ? snapshot.yesterdayCompleted.map((task) => <div className="dashboard-review" key={task.id}><span>✓</span><div><strong>{task.title}</strong><small>{task.checkpoint || "완료 기록"}</small></div></div>) : <Empty text="어제 완료로 기록된 작업이 없습니다." />}
      </DashboardCard>
      <DashboardCard title="오늘의 Development" meta={`${snapshot.todayCommits.length} commits · ${snapshot.todayPullRequests.length} PRs`}>
        {[...snapshot.todayCommits.map((commit) => ({ id: `c:${commit.repository}:${commit.sha}`, symbol: commit.sha.slice(0, 7), title: commit.message, detail: commit.repository, url: commit.url })), ...snapshot.todayPullRequests.map((pr) => ({ id: `p:${pr.repository}:${pr.number}`, symbol: `PR #${pr.number}`, title: pr.title, detail: pr.repository, url: pr.url }))].map((item) => <button className="dashboard-development" type="button" key={item.id} onClick={() => void openUrl(item.url)}><span>{item.symbol}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>↗</b></button>)}
        {snapshot.todayCommits.length + snapshot.todayPullRequests.length === 0 && <Empty text="Jira/GitHub 캐시에서 오늘 활동을 찾지 못했습니다." />}
      </DashboardCard>
    </div>
    <p className="dashboard-footnote">오늘 할 일은 현재 미완료 Task, 커밋은 Jira Development에서 발견된 내역, PR은 오늘 업데이트된 열린 PR 기준입니다.</p>
  </div>;
}

function DashboardCard({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) { return <section className="dashboard-card"><header><h3>{title}</h3><span>{meta}</span></header><div>{children}</div></section>; }
function Metric({ value, label }: { value: number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function Empty({ text }: { text: string }) { return <div className="dashboard-empty">{text}</div>; }
function statusLabel(status: string) { return ({ focus: "집중", review: "확인", ai_running: "진행", todo: "할 일", blocked: "막힘", inbox: "Inbox" } as Record<string,string>)[status] || status; }
