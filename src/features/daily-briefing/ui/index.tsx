import { openUrl } from "@tauri-apps/plugin-opener";
import { Bot, CalendarDays, CheckCircle2, ExternalLink, GitBranch, GitPullRequest, ListTodo, LoaderCircle, RefreshCw, Sparkles, SunMedium, TriangleAlert, X } from "lucide-react";
import type { DailyBriefing, DailyBriefingItem, DailyBriefingSection, DailyBriefingSource } from "../../../entities/work-context/model/daily-briefing";
import { ServiceIcon } from "../../../shared/ui";
import "./style.scss";

function BriefingSourceIcon({ source, size }: { source: DailyBriefingSource; size: number }) {
  if (source === "slack" || source === "jira") return <ServiceIcon kind={source} size={size} />;
  if (source === "ai_session") return <ServiceIcon kind="openai" size={size} />;
  if (source === "calendar") return <CalendarDays size={size} />;
  if (source === "github_pr") return <GitPullRequest size={size} />;
  if (source === "local_git") return <GitBranch size={size} />;
  return <ListTodo size={size} />;
}

function BriefingReportSection({ title, section, icon, tone }: {
  title: string;
  section: DailyBriefingSection;
  icon: React.ReactNode;
  tone: "done" | "today" | "attention";
}) {
  return <section className={`daily-report-section is-${tone}`}>
    <header><span>{icon}</span><div><h3>{title}</h3><p>{section.summary}</p></div><b>{section.items.length}</b></header>
    {section.items.length > 0
      ? <div className="daily-report-items">{section.items.map((item) => <ReportItem item={item} key={item.id} />)}</div>
      : <div className="daily-report-none">기록된 항목이 없습니다.</div>}
  </section>;
}

function ReportItem({ item }: { item: DailyBriefingItem }) {
  return <article>
    <span className="daily-report-item-icon"><BriefingSourceIcon source={item.source} size={14} /></span>
    <div><strong>{item.title}</strong><p>{item.detail}</p></div>
    {item.occurredAt && <time dateTime={item.occurredAt}>{displayTime(item.occurredAt)}</time>}
  </article>;
}

export default function DailyBriefingPanel({ briefing, isCollecting, error, onCollect, onClose }: {
  briefing: DailyBriefing | null;
  isCollecting: boolean;
  error: string | null;
  onCollect: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="daily-briefing-backdrop modal-backdrop" onMouseDown={onClose}>
      <section className="daily-briefing-panel" role="dialog" aria-modal="true" aria-labelledby="daily-briefing-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="daily-briefing-mark"><Bot size={20} /></div>
          <div><span>ORBIT ASSISTANT</span><h2 id="daily-briefing-title">오늘의 업무 브리핑</h2><p>어제의 실행 기록과 오늘의 계획, 놓치기 쉬운 신호를 한 문서로 정리합니다.</p></div>
          <button type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="daily-briefing-sources" aria-label="수집 소스">
          {(briefing?.sources || [
            { source: "slack" as const, label: "Slack", count: 0 }, { source: "jira" as const, label: "Jira", count: 0 },
            { source: "ai_session" as const, label: "AI 세션", count: 0 }, { source: "calendar" as const, label: "Calendar", count: 0 },
            { source: "github_pr" as const, label: "GitHub PR", count: 0 }, { source: "local_git" as const, label: "로컬 Git", count: 0 },
          ]).map((source) => <div key={source.source}><BriefingSourceIcon source={source.source} size={14} /><span><strong>{source.label}</strong><small>{isCollecting ? "수집 중" : `${source.count}건`}</small></span></div>)}
        </div>

        {!briefing && !isCollecting && <div className="daily-briefing-empty"><Sparkles size={26} /><strong>오늘의 업무 리포트를 만들어보세요</strong><p>연결된 도구의 실제 기록만 읽어 어제 한 일과 오늘 할 일을 정리합니다.</p><button className="primary-button" type="button" onClick={() => void onCollect()}><Sparkles size={15} />브리핑 만들기</button></div>}
        {isCollecting && <div className="daily-briefing-empty"><LoaderCircle className="daily-briefing-spinner" size={27} /><strong>업무 기록을 정리하고 있어요</strong><p>Slack, Jira, AI 세션, Calendar, GitHub와 로컬 Git을 확인합니다.</p></div>}
        {error && <div className="daily-briefing-error" role="alert">브리핑을 만들지 못했습니다. {error}</div>}

        {briefing && !isCollecting && <div className="daily-briefing-content">
          <div className="daily-briefing-toolbar"><span><strong>{formatReportDate(briefing.generatedAt)} 업무 리포트</strong><small>{displayGeneratedAt(briefing.generatedAt)} 기준 · 읽기 전용</small></span><button type="button" onClick={() => void onCollect()}><RefreshCw size={14} />새로 정리</button></div>
          <div className="daily-report-scroll">
            <BriefingReportSection title="어제 한 일" section={briefing.yesterday} icon={<CheckCircle2 size={17} />} tone="done" />
            <BriefingReportSection title="오늘 예정" section={briefing.today} icon={<SunMedium size={17} />} tone="today" />
            <BriefingReportSection title="확인 필요" section={briefing.attention} icon={<TriangleAlert size={17} />} tone="attention" />

            <section className="daily-report-references">
              <header><div><h3>참고 컨텍스트</h3><p>리포트 작성에 사용된 원문을 바로 열 수 있습니다.</p></div><b>{briefing.references.length}</b></header>
              {briefing.references.length > 0 ? <div>{briefing.references.map((reference, index) => <button type="button" key={`${reference.source}-${reference.url}-${index}`} onClick={() => reference.url && void openUrl(reference.url)}>
                <BriefingSourceIcon source={reference.source} size={14} /><span><strong>{reference.label}</strong><small>{reference.detail}</small></span><ExternalLink size={13} />
              </button>)}</div> : <p className="daily-report-none">열 수 있는 외부 링크가 없습니다.</p>}
            </section>
            {briefing.notices.length > 0 && <details className="daily-briefing-notices"><summary>수집 안내 {briefing.notices.length}건</summary>{briefing.notices.map((notice) => <p key={notice}>{notice}</p>)}</details>}
          </div>
        </div>}

        <footer><span>원본 업무 도구와 Task는 변경하지 않습니다.</span><button className="primary-button" type="button" onClick={onClose}>확인</button></footer>
      </section>
    </div>
  );
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
function displayGeneratedAt(value: string) { return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatReportDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(value)); }
