import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectTaskContext,
  discoverTaskContext,
  type ContextDiscoveryResult,
  type DiscoveryProgress,
} from "../data/context-discovery-repository";
import {
  recommendedContextCandidateIds,
  type ContextCandidate,
  type ContextCandidateSource,
} from "../domain/context-discovery";
import ServiceIcon, { serviceIconForProvider, type ServiceIconKind } from "../components/ServiceIcon";
import "./TaskContextDiscoveryModal.scss";

interface DiscoveryTask {
  id: string;
  title: string;
  description: string;
}

const sourceMeta: Record<ContextCandidateSource, { label: string; icon: ServiceIconKind }> = {
  ai_session: { label: "AI 세션", icon: "openai" },
  jira: { label: "Jira", icon: "jira" },
  slack: { label: "Slack", icon: "slack" },
};

export default function TaskContextDiscoveryModal({
  task,
  onClose,
  onConnected,
}: {
  task: DiscoveryTask;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const [progress, setProgress] = useState<DiscoveryProgress>({ percent: 3, label: "컨텍스트 탐색을 준비하고 있어요" });
  const [result, setResult] = useState<ContextDiscoveryResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setProgress({ percent: 3, label: "컨텍스트 탐색을 준비하고 있어요" });
    void discoverTaskContext(task.title, task.description, (next) => {
      if (!cancelled) setProgress(next);
    }).then((next) => {
      if (cancelled) return;
      setResult(next);
      setSelectedIds(recommendedContextCandidateIds(next.candidates));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [attempt, task.description, task.title]);

  const counts = useMemo(() => {
    const next = { codex: 0, claude: 0, jira: 0, slack: 0 };
    result?.candidates.forEach((candidate) => {
      if (candidate.source === "ai_session") next[candidate.provider === "claude" ? "claude" : "codex"] += 1;
      else next[candidate.source] += 1;
    });
    return next;
  }, [result]);

  const selected = result?.candidates.filter((candidate) => selectedIds.has(candidate.id)) || [];

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function connect() {
    setIsConnecting(true);
    setError(null);
    try {
      await connectTaskContext(task.id, selected);
      await onConnected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setIsConnecting(false);
    }
  }

  return (
    <div className="modal-backdrop context-discovery-backdrop">
      <section className="context-discovery-modal" aria-labelledby="context-discovery-title">
        <header>
          <div>
            <span>새 Task · 컨텍스트 연결</span>
            <h2 id="context-discovery-title">{result ? "관련 작업을 찾았습니다" : "Task 컨텍스트 수집 중…"}</h2>
            <p>{task.title}{task.description ? ` · ${task.description}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="나중에 연결">×</button>
        </header>

        {!result && !error && (
          <div className="context-discovery-loading">
            <div
              className="context-discovery-progress"
              role="progressbar"
              aria-label="Task 컨텍스트 수집 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
            >
              <i style={{ width: progress.percent + "%" }} />
            </div>
            <div className="context-discovery-progress-copy">
              <strong>{progress.label}</strong>
              <span>{progress.percent}%</span>
            </div>
            <SourceSteps activePercent={progress.percent} />
            <p className="context-discovery-privacy">Task 제목·Description과 후보 요약을 OpenAI로 보내 관련도를 분석합니다. Slack은 메시지 일부가 후보 요약에 포함됩니다.</p>
          </div>
        )}

        {error && !result && (
          <div className="context-discovery-failed">
            <strong>컨텍스트를 수집하지 못했습니다</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setAttempt((current) => current + 1)}>다시 시도</button>
          </div>
        )}

        {result && (
          <>
            <div className="context-discovery-source-summary">
              <SourceSummary icon="openai" label="Codex" value={counts.codex + "개"} />
              <SourceSummary icon="claude" label="Claude" value={counts.claude + "개"} />
              <SourceSummary icon="jira" label="Jira 티켓" value={counts.jira + "개"} />
              <SourceSummary icon="slack" label="Slack 메시지" value={counts.slack + "개"} />
            </div>

            {result.notices.length > 0 && (
              <div className="context-discovery-notices">
                {result.notices.map((notice) => <p key={notice}>{notice}</p>)}
              </div>
            )}

            {result.candidates.length > 0 ? (
              <div className="context-discovery-results">
                <div className="context-discovery-result-heading">
                  <div>
                    <strong>{result.candidates.length}개의 관련 컨텍스트</strong>
                    <span>{result.usedAi ? "AI 관련도 분석 완료" : "로컬 관련도 분석 결과"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(selectedIds.size === result.candidates.length
                      ? new Set()
                      : new Set(result.candidates.map((candidate) => candidate.id)))}
                  >
                    {selectedIds.size === result.candidates.length ? "전체 해제" : "전체 선택"}
                  </button>
                </div>
                <div className="context-discovery-candidates">
                  {result.candidates.map((candidate) => (
                    <CandidateRow
                      candidate={candidate}
                      selected={selectedIds.has(candidate.id)}
                      onToggle={() => toggle(candidate.id)}
                      key={candidate.id}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="context-discovery-empty">
                <strong>관련 컨텍스트를 찾지 못했습니다</strong>
                <span>Task는 만들어졌습니다. 나중에 Task의 연결 화면에서 직접 추가할 수 있어요.</span>
              </div>
            )}
          </>
        )}

        <footer>
          <button type="button" onClick={onClose} disabled={isConnecting}>나중에 연결</button>
          {result && result.candidates.length > 0 && (
            <button className="primary-button" type="button" onClick={() => void connect()} disabled={selected.length === 0 || isConnecting}>
              {isConnecting ? "연결 중…" : "선택한 " + selected.length + "개 연결"}
            </button>
          )}
          {result && result.candidates.length === 0 && (
            <button className="primary-button" type="button" onClick={onClose}>확인</button>
          )}
        </footer>
        {error && result && <div className="context-discovery-connect-error">{error}</div>}
      </section>
    </div>
  );
}

function SourceSteps({ activePercent }: { activePercent: number }) {
  const steps = [
    { label: "AI 세션", doneAt: 30 },
    { label: "Jira 티켓", doneAt: 50 },
    { label: "Slack 메시지", doneAt: 68 },
    { label: "AI 관련도 분석", doneAt: 100 },
  ];
  return (
    <div className="context-discovery-steps">
      {steps.map((step) => (
        <div className={activePercent >= step.doneAt ? "done" : ""} key={step.label}>
          <i>{activePercent >= step.doneAt ? "✓" : ""}</i>
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  );
}

function SourceSummary({ icon, label, value, muted = false }: {
  icon: ServiceIconKind;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={muted ? "muted" : ""}>
      <i className={icon}><ServiceIcon kind={icon} size={15} /></i>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CandidateRow({ candidate, selected, onToggle }: {
  candidate: ContextCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
  const meta = sourceMeta[candidate.source];
  const icon = candidate.source === "ai_session" && candidate.provider
    ? serviceIconForProvider(candidate.provider)
    : meta.icon;
  const sourceLabel = candidate.source === "ai_session"
    ? candidate.provider === "claude" ? "Claude" : "Codex"
    : meta.label;
  return (
    <label className={"context-discovery-candidate " + (selected ? "selected" : "")}>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <i className={icon}><ServiceIcon kind={icon} size={17} /></i>
      <span>
        <strong>{candidate.title}</strong>
        <small>{sourceLabel} · {candidate.detail}</small>
        <em>{candidate.reason}</em>
      </span>
      <b>{candidate.score}%</b>
    </label>
  );
}
