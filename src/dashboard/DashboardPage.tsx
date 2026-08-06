import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  GitCommitHorizontal,
  GitPullRequest,
  TicketCheck,
} from "lucide-react";
import {
  loadDashboardSnapshot,
  type DashboardPeriod,
  type DashboardSnapshot,
  type DashboardWin,
} from "../data/dashboard-repository";
import "./DashboardPage.scss";

const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>(7);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void loadDashboardSnapshot(period)
      .then((next) => active && setSnapshot(next))
      .catch((cause) => active && setError(String(cause)));
    return () => { active = false; };
  }, [period]);

  if (error) return <div className="dashboard-error">대시보드를 불러오지 못했습니다. {error}</div>;
  if (!snapshot) return <div className="dashboard-loading">업무 성과를 집계하는 중…</div>;

  const totalOutput = snapshot.completedTasks + snapshot.completedJira + snapshot.commits;
  const maxActivity = Math.max(1, ...snapshot.dailyActivity.map((day) => day.total));

  return (
    <main className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">PERFORMANCE</span>
          <h2>{period === 7 ? "이번 주" : "최근 30일"} 성과</h2>
          <p>연결된 업무 기록에서 <strong>{totalOutput}건의 산출 활동</strong>을 확인했어요.</p>
        </div>
        <div className="dashboard-period" role="group" aria-label="성과 집계 기간">
          <button className={period === 7 ? "active" : ""} type="button" onClick={() => setPeriod(7)}>7일</button>
          <button className={period === 30 ? "active" : ""} type="button" onClick={() => setPeriod(30)}>30일</button>
        </div>
      </header>

      <section className="dashboard-kpis" aria-label="핵심 성과 지표">
        <Kpi icon={CheckCircle2} tone="success" label="완료한 Task" value={snapshot.completedTasks} detail={`전체 누적 ${snapshot.totalCompletedTasks}개`} />
        <Kpi icon={TicketCheck} tone="info" label="완료 상태 Jira" value={snapshot.completedJira} detail={`현재 완료 상태 ${snapshot.totalCompletedJira}개`} />
        <Kpi icon={GitCommitHorizontal} tone="violet" label="발견된 커밋" value={snapshot.commits} detail={`연결 기록 누적 ${snapshot.totalCommits}개`} />
        <Kpi icon={GitPullRequest} tone="neutral" label="내가 올린 열린 PR" value={snapshot.openPullRequests} detail={`리뷰 대기 ${snapshot.reviewRequests}개`} />
      </section>

      <section className="dashboard-layout">
        <article className="dashboard-panel dashboard-trend">
          <PanelHeading icon={Activity} title="산출 추세" meta={`Task · Jira · commit / ${period}일`} />
          <div className="dashboard-chart-legend" aria-hidden="true"><span className="task">Task</span><span className="jira">Jira</span><span className="commit">Commit</span></div>
          <div className={`dashboard-bars period-${period}`} role="img" aria-label={`${period}일 동안 Task 완료, Jira 완료 상태 변경, 커밋 활동을 날짜별로 표시한 차트`}>
            {snapshot.dailyActivity.map((day, index) => (
              <div className="dashboard-bar-column" key={day.date} title={`${day.label}: Task ${day.tasks}, Jira ${day.jira}, commit ${day.commits}`}>
                <div className="dashboard-bar-track">
                  <div className="dashboard-bar-stack" style={{ height: `${Math.max(day.total ? 8 : 0, (day.total / maxActivity) * 100)}%` }}>
                    {day.commits > 0 && <i className="commit" style={{ flex: day.commits }} />}
                    {day.jira > 0 && <i className="jira" style={{ flex: day.jira }} />}
                    {day.tasks > 0 && <i className="task" style={{ flex: day.tasks }} />}
                  </div>
                </div>
                {(period === 7 || index % 5 === 0 || index === snapshot.dailyActivity.length - 1) && <span>{day.label}</span>}
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-panel dashboard-health">
          <PanelHeading icon={Bot} title="업무 건강도" meta={`${snapshot.currentTasks.length}개 진행 중`} />
          <div className="dashboard-health-list">
            {snapshot.workHealth.map((item) => (
              <div className={`health-${item.status}`} key={item.status}>
                <div><span>{item.label}</span><strong>{item.count}</strong></div>
                <progress max={Math.max(1, snapshot.currentTasks.length)} value={item.count}>{item.count}</progress>
              </div>
            ))}
          </div>
          <div className="dashboard-attention">
            <span><Eye size={15} /> 리뷰 요청 PR <strong>{snapshot.reviewRequests}</strong></span>
            <span><AlertTriangle size={15} /> 막힌 Task <strong>{snapshot.workHealth.find((item) => item.status === "blocked")?.count || 0}</strong></span>
            <span><Clock3 size={15} /> 오늘 일정 <strong>{snapshot.todayEvents.length}</strong></span>
          </div>
        </article>

        <article className="dashboard-panel dashboard-wins">
          <PanelHeading icon={CheckCircle2} title="최근 성과" meta="가장 최근 기록부터" />
          <div className="dashboard-win-list">
            {snapshot.recentWins.length ? snapshot.recentWins.map((win) => <Win key={win.id} win={win} />) : <Empty text="선택한 기간에 기록된 성과가 없습니다." />}
          </div>
        </article>

        <aside className="dashboard-side-stack">
          <article className="dashboard-panel dashboard-projects">
            <PanelHeading icon={TicketCheck} title="프로젝트별 완료" meta="Jira 기준" />
            {snapshot.projectBreakdown.length ? <ProjectBars items={snapshot.projectBreakdown} /> : <Empty text="기간 내 완료 상태 Jira가 없습니다." />}
          </article>
          <article className="dashboard-panel dashboard-scope">
            <PanelHeading icon={Database} title="집계 범위" meta="데이터 정확도" />
            <ul>
              <li><strong>Task</strong><span>실제 완료 시각 기준</span></li>
              <li><strong>Jira</strong><span>완료 상태의 최근 변경 시각 기준</span></li>
              <li><strong>Commit</strong><span>Jira 개발 정보에서 발견된 기록</span></li>
              <li><strong>PR</strong><span>현재 GitHub에 열린 내 PR</span></li>
            </ul>
          </article>
        </aside>
      </section>
    </main>
  );
}

function Kpi({ icon: Icon, tone, label, value, detail }: { icon: typeof CheckCircle2; tone: string; label: string; value: number; detail: string }) {
  return <article className={`dashboard-kpi tone-${tone}`}><div className="dashboard-kpi-icon"><Icon size={19} strokeWidth={1.8} /></div><div><span>{label}</span><strong>{value}<small>건</small></strong><p>{detail}</p></div></article>;
}

function PanelHeading({ icon: Icon, title, meta }: { icon: typeof Activity; title: string; meta: string }) {
  return <header className="dashboard-panel-heading"><div><Icon size={17} strokeWidth={1.8} /><h3>{title}</h3></div><span>{meta}</span></header>;
}

function Win({ win }: { win: DashboardWin }) {
  const Icon = win.kind === "task" ? CheckCircle2 : win.kind === "jira" ? TicketCheck : GitCommitHorizontal;
  const content = <><span className={`dashboard-win-icon kind-${win.kind}`}><Icon size={16} /></span><div><strong>{win.title}</strong><small>{win.detail}</small></div><time>{dateTime.format(new Date(win.occurredAt))}</time></>;
  return win.url
    ? <button className="dashboard-win" type="button" onClick={() => void openUrl(win.url!)}>{content}</button>
    : <div className="dashboard-win">{content}</div>;
}

function ProjectBars({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return <div className="dashboard-project-bars">{items.map((item) => <div key={item.label}><div><span>{item.label}</span><strong>{item.count}</strong></div><i><b style={{ width: `${(item.count / max) * 100}%` }} /></i></div>)}</div>;
}

function Empty({ text }: { text: string }) { return <div className="dashboard-empty">{text}</div>; }
