import { useMemo, useState } from "react";
import { AlarmClock, ArrowRight, Check, Flag, Sparkles, X } from "lucide-react";
import type { WorkItem } from "../domain/work-item";
import type { TaskAiFixPlan } from "../domain/task-ai-fix";
import { applyTaskAiFixes } from "../data/work-item-repository";
import { generateTaskAiFixPlan } from "../data/task-ai-fix-repository";
import { requestTaskReminderPermission } from "../notifications/task-reminders";
import "./TaskAiFix.scss";

const priorityLabel = { p1: "P1", p2: "P2", p3: "P3" } as const;

function formatTarget(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function TaskAiFix({ items, onApplied }: { items: WorkItem[]; onApplied: () => Promise<void> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [plan, setPlan] = useState<TaskAiFixPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openItems = useMemo(() => items.filter(({ status }) => status !== "done"), [items]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  function close() {
    if (isAnalyzing || isApplying) return;
    setIsOpen(false);
    setPlan(null);
    setError(null);
  }

  async function analyze() {
    setIsAnalyzing(true);
    setError(null);
    try {
      setPlan(await generateTaskAiFixPlan(openItems));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function applyPlan() {
    if (!plan) return;
    setIsApplying(true);
    setError(null);
    try {
      await requestTaskReminderPermission().catch(() => false);
      await applyTaskAiFixes(plan.suggestions);
      await onApplied();
      setIsApplying(false);
      setIsOpen(false);
      setPlan(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setIsApplying(false);
    }
  }

  return (
    <>
      <button className="task-ai-fix-fab" type="button" onClick={() => setIsOpen(true)} disabled={openItems.length === 0} aria-label="AI로 Task 우선순위와 목표 시간 정리">
        <Sparkles size={19} strokeWidth={1.8} aria-hidden="true" />
        <span>Fix</span>
      </button>

      {isOpen && (
        <div className="modal-backdrop task-ai-fix-backdrop" onMouseDown={close}>
          <section className="task-ai-fix-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div className="task-ai-fix-mark"><Sparkles size={20} strokeWidth={1.8} aria-hidden="true" /></div>
              <button type="button" onClick={close} disabled={isAnalyzing || isApplying} aria-label="닫기"><X size={18} /></button>
            </header>

            {!plan ? (
              <div className="task-ai-fix-consent">
                <span>AI TASK FIX</span>
                <h2>AI가 전체 Task를 정리할까요?</h2>
                <p>미완료 Task {openItems.length}개의 제목·Description·현재 상태와 앞으로 7일간의 일정이 OpenAI로 전송됩니다.</p>
                <div className="task-ai-fix-effects">
                  <div><Flag size={16} /><span><strong>우선순위 판단</strong><small>P1·P2·P3로 업무 순서를 정합니다.</small></span></div>
                  <div><AlarmClock size={16} /><span><strong>목표 시간 계획</strong><small>일정과 업무량을 고려해 완료 시각을 배치합니다.</small></span></div>
                </div>
                <p className="task-ai-fix-safety"><Check size={14} /> 분석만으로는 Task가 변경되지 않습니다. 결과를 확인한 뒤 적용할 수 있어요.</p>
              </div>
            ) : (
              <div className="task-ai-fix-preview">
                <span>AI 분석 완료</span>
                <h2>이렇게 정리할게요</h2>
                <p>{plan.summary || "업무 연속성과 일정을 기준으로 우선순위와 목표 시간을 배치했습니다."}</p>
                <div className="task-ai-fix-list">
                  {plan.suggestions.map((suggestion) => {
                    const item = itemById.get(suggestion.id);
                    return (
                      <article key={suggestion.id}>
                        <b className={suggestion.priority}>{priorityLabel[suggestion.priority]}</b>
                        <div><strong>{item?.title || "Task"}</strong><span>{suggestion.reason}</span></div>
                        <time><AlarmClock size={13} />{formatTarget(suggestion.targetAt)}</time>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <div className="task-ai-fix-error" role="alert">{error}</div>}
            <footer>
              <button type="button" onClick={close} disabled={isAnalyzing || isApplying}>취소</button>
              {!plan ? (
                <button className="primary-button" type="button" onClick={() => void analyze()} disabled={isAnalyzing}>
                  {isAnalyzing ? <><span className="task-ai-spinner" />AI가 판단하는 중…</> : <>분석 시작<ArrowRight size={14} /></>}
                </button>
              ) : (
                <button className="primary-button" type="button" onClick={() => void applyPlan()} disabled={isApplying}>
                  {isApplying ? "적용 중…" : `${plan.suggestions.length}개 Task에 적용`}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
