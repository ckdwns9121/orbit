import { useState } from "react";
import { Bot, CalendarDays, Check, ChevronRight, GitBranch, GitPullRequest, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import type { DailyBriefing, DailyBriefingCandidate, DailyBriefingSource } from "../../../entities/work-context/model/daily-briefing";
import { ServiceIcon } from "../../../shared/ui";
import "./style.scss";

function BriefingSourceIcon({ source, size }: { source: DailyBriefingSource; size: number }) {
  if (source === "slack" || source === "jira") return <ServiceIcon kind={source} size={size} />;
  if (source === "ai_session") return <ServiceIcon kind="openai" size={size} />;
  if (source === "calendar") return <CalendarDays size={size} />;
  if (source === "github_pr") return <GitPullRequest size={size} />;
  return <GitBranch size={size} />;
}

export default function DailyBriefingPanel({ briefing, isCollecting, error, onCollect, onApprove, onClose }: {
  briefing: DailyBriefing | null;
  isCollecting: boolean;
  error: string | null;
  onCollect: () => Promise<void>;
  onApprove: (candidates: DailyBriefingCandidate[]) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const selected = briefing?.candidates.filter((item) => selectedIds.has(item.id)) || [];

  async function collect() {
    setSelectedIds(new Set());
    await onCollect();
  }

  async function approve() {
    if (!selected.length || isApproving) return;
    setIsApproving(true);
    setApproveError(null);
    try {
      await onApprove(selected);
      onClose();
    } catch (cause) {
      setApproveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <div className="daily-briefing-backdrop modal-backdrop" onMouseDown={onClose}>
      <section className="daily-briefing-panel" role="dialog" aria-modal="true" aria-labelledby="daily-briefing-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="daily-briefing-mark"><Bot size={20} /></div>
          <div><span>ORBIT ASSISTANT</span><h2 id="daily-briefing-title">오늘의 업무 브리핑</h2><p>연결된 도구를 읽고 오늘 확인할 작업 후보와 근거를 정리합니다.</p></div>
          <button type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="daily-briefing-sources" aria-label="수집 소스">
          {(briefing?.sources || [
            { source: "slack" as const, label: "Slack", count: 0 }, { source: "jira" as const, label: "Jira", count: 0 },
            { source: "ai_session" as const, label: "AI 세션", count: 0 }, { source: "calendar" as const, label: "Calendar", count: 0 },
            { source: "github_pr" as const, label: "GitHub PR", count: 0 }, { source: "local_git" as const, label: "로컬 Git", count: 0 },
          ]).map((source) => <div key={source.source}><BriefingSourceIcon source={source.source} size={14} /><span><strong>{source.label}</strong><small>{isCollecting ? "수집 중" : `${source.count}건`}</small></span></div>)}
        </div>

        {!briefing && !isCollecting && (
          <div className="daily-briefing-empty"><Sparkles size={26} /><strong>오늘의 신호를 한 번에 모아보세요</strong><p>Slack 멘션, 담당 Jira, 최근 AI 세션, 오늘 일정, PR과 로컬 Git 작업을 확인합니다.</p><button className="primary-button" type="button" onClick={() => void collect()}><Sparkles size={15} />브리핑 만들기</button></div>
        )}
        {isCollecting && <div className="daily-briefing-empty"><LoaderCircle className="daily-briefing-spinner" size={27} /><strong>업무 도구를 확인하고 있어요</strong><p>원본 데이터를 변경하지 않고 읽기 전용으로 수집합니다.</p></div>}
        {error && <div className="daily-briefing-error" role="alert">브리핑을 만들지 못했습니다. {error}</div>}
        {approveError && <div className="daily-briefing-error" role="alert">Task를 추가하지 못했습니다. {approveError}</div>}

        {briefing && !isCollecting && (
          <div className="daily-briefing-content">
            <div className="daily-briefing-toolbar"><span><strong>{briefing.candidates.length}개의 후보</strong><small>{briefing.usedAi ? "AI 우선순위 분석 완료" : "규칙 기반 분석"}</small></span><button type="button" onClick={() => void collect()}><RefreshCw size={14} />다시 수집</button></div>
            <div className="daily-briefing-list">
              {briefing.candidates.map((candidate) => {
                const checked = selectedIds.has(candidate.id);
                return <article className={checked ? "is-selected" : ""} key={candidate.id}>
                  <button className="daily-briefing-check" type="button" aria-pressed={checked} onClick={() => setSelectedIds((current) => { const next = new Set(current); checked ? next.delete(candidate.id) : next.add(candidate.id); return next; })}>{checked && <Check size={14} />}</button>
                  <div className="daily-briefing-copy"><div><b>{candidate.priority.toUpperCase()}</b><strong>{candidate.title}</strong><em>{candidate.score}%</em></div><p>{candidate.description}</p><small>{candidate.reason}</small>
                    <div className="daily-briefing-evidence">{candidate.evidence.map((evidence, index) => <span key={`${evidence.source}-${index}`}><BriefingSourceIcon source={evidence.source} size={12} /><i>{evidence.label}</i></span>)}</div>
                  </div>
                  <ChevronRight size={15} />
                </article>;
              })}
              {briefing.candidates.length === 0 && <div className="daily-briefing-empty"><CalendarDays size={25} /><strong>새로 제안할 작업이 없어요</strong><p>이미 Task에 있거나 오늘 확인할 강한 신호가 없습니다.</p></div>}
            </div>
            {briefing.notices.length > 0 && <details className="daily-briefing-notices"><summary>일부 소스 안내 {briefing.notices.length}건</summary>{briefing.notices.map((notice) => <p key={notice}>{notice}</p>)}</details>}
          </div>
        )}

        <footer><span>선택한 후보만 Task와 오늘 Planner에 추가됩니다.</span><button type="button" onClick={onClose}>취소</button><button className="primary-button" type="button" disabled={!selected.length || isApproving} onClick={() => void approve()}>{isApproving ? "추가 중…" : `${selected.length}개 추가`}</button></footer>
      </section>
    </div>
  );
}
