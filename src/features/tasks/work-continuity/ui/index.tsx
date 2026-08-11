import { useState, type FormEvent } from "react";
import { CheckCircle2, FileText, Link2, LockKeyhole, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorkItem, WorkItemStatus } from "../../../../entities/work-context/model/work-item";
import { validateCompletion, validateInterruption } from "../model";
import "./style.scss";

export type InterruptionValues = {
  checkpoint: string;
  nextAction: string;
  blockedReason: string;
  resumeCondition: string;
  nextReviewAt: string | null;
};

export function InterruptionDialog({
  item,
  targetStatus,
  destination,
  evidence = [],
  draft,
  onCancel,
  onConfirm,
}: {
  item: WorkItem;
  targetStatus: WorkItemStatus;
  destination: string;
  evidence?: Array<{ label: string; url?: string }>;
  draft?: { checkpoint?: string; nextAction?: string };
  onCancel: () => void;
  onConfirm: (values: InterruptionValues) => Promise<void>;
}) {
  const continuity = item as WorkItem & Partial<InterruptionValues>;
  const [values, setValues] = useState<InterruptionValues>({
    checkpoint: item.checkpoint || draft?.checkpoint || "",
    nextAction: item.nextAction || draft?.nextAction || "",
    blockedReason: continuity.blockedReason || "",
    resumeCondition: continuity.resumeCondition || "",
    nextReviewAt: continuity.nextReviewAt || null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  function change(key: keyof InterruptionValues, value: string) {
    setValues((current) => ({ ...current, [key]: value || (key === "nextReviewAt" ? null : "") }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateInterruption({ ...values, targetStatus });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setIsSaving(true);
    try { await onConfirm(values); } finally { setIsSaving(false); }
  }

  return (
    <div className="modal-backdrop checkpoint-backdrop" role="presentation">
      <form className="continuity-dialog" aria-labelledby="interruption-title" onSubmit={submit}>
        <header>
          <div><span>작업 전환 전 기록</span><h2 id="interruption-title">{item.title}</h2><p><strong>{destination}</strong>(으)로 이동하기 전에 돌아올 지점을 남겨주세요.</p></div>
          <button type="button" aria-label="닫기" onClick={onCancel}><X size={17} /></button>
        </header>

        {evidence.length > 0 && (
          <section className="continuity-draft-evidence" aria-label="초안 근거">
            <div><FileText size={14} /><strong>연결 근거로 초안을 준비했어요</strong></div>
            <ul>{evidence.slice(0, 4).map((entry) => <li key={`${entry.label}:${entry.url ?? ""}`}>{entry.url ? <button type="button" onClick={() => void openUrl(entry.url!)}><Link2 size={11} />{entry.label}</button> : <span><Link2 size={11} />{entry.label}</span>}</li>)}</ul>
          </section>
        )}

        <div className="continuity-form-grid">
          <Field label="현재까지 한 것" required error={errors.checkpoint}>
            <textarea value={values.checkpoint} onChange={(event) => change("checkpoint", event.target.value)} autoFocus placeholder="구현·확인한 지점과 남은 맥락" />
          </Field>
          <Field label="돌아왔을 때 첫 행동" required error={errors.nextAction}>
            <textarea value={values.nextAction} onChange={(event) => change("nextAction", event.target.value)} placeholder="10분 안에 바로 시작할 수 있는 행동" />
          </Field>
          {targetStatus === "blocked" && (
            <>
              <Field label="막힌 이유" required error={errors.blockedReason}>
                <input value={values.blockedReason} onChange={(event) => change("blockedReason", event.target.value)} placeholder="예: API 권한 승인 대기" />
              </Field>
              <Field label="재개 조건" required error={errors.resumeCondition}>
                <input value={values.resumeCondition} onChange={(event) => change("resumeCondition", event.target.value)} placeholder="예: 관리자 승인 완료 알림 수신" />
              </Field>
              <Field label="다시 확인할 시각">
                <input type="datetime-local" value={values.nextReviewAt?.slice(0, 16) || ""} onChange={(event) => change("nextReviewAt", event.target.value ? new Date(event.target.value).toISOString() : "")} />
              </Field>
            </>
          )}
        </div>
        <div className="continuity-dialog-note"><LockKeyhole size={13} /> 저장 전에는 작업 상태가 바뀌지 않습니다.</div>
        <footer><button type="button" onClick={onCancel}>계속 작업</button><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "저장 중…" : "기록하고 전환"}</button></footer>
      </form>
    </div>
  );
}

export type CompletionValues = {
  resultSummary: string;
  decisions: string;
  remainingRisks: string;
  retrospective: string;
};

export function CompletionSheet({
  item,
  evidence = [],
  onCancel,
  onComplete,
}: {
  item: WorkItem;
  evidence?: Array<{ label: string; url?: string | null; kind?: string }>;
  onCancel: () => void;
  onComplete: (values: CompletionValues) => Promise<void>;
}) {
  const [values, setValues] = useState<CompletionValues>({
    resultSummary: item.checkpoint || "",
    decisions: "",
    remainingRisks: "없음",
    retrospective: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  function change(key: keyof CompletionValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateCompletion(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setIsSaving(true);
    try { await onComplete(values); } finally { setIsSaving(false); }
  }

  return (
    <div className="modal-backdrop checkpoint-backdrop" role="presentation">
      <form className="continuity-dialog completion-sheet" aria-labelledby="completion-title" onSubmit={submit}>
        <header><div><span>완료 기록</span><h2 id="completion-title">{item.title}</h2><p>결과와 판단을 남기면 다음 작업과 회고에서 다시 찾을 수 있어요.</p></div><button type="button" aria-label="닫기" onClick={onCancel}><X size={17} /></button></header>
        <div className="completion-evidence-summary"><CheckCircle2 size={15} /><div><strong>{evidence.length}개의 연결 근거를 함께 보관합니다</strong><span>Jira, PR, commit, AI 세션 링크는 완료 시점의 스냅샷으로 저장됩니다.</span></div></div>
        <div className="continuity-form-grid completion-grid">
          <Field label="결과 요약" required error={errors.resultSummary}><textarea value={values.resultSummary} onChange={(event) => change("resultSummary", event.target.value)} autoFocus /></Field>
          <Field label="주요 결정" required error={errors.decisions}><textarea value={values.decisions} onChange={(event) => change("decisions", event.target.value)} /></Field>
          <Field label="남은 위험" required error={errors.remainingRisks}><textarea value={values.remainingRisks} onChange={(event) => change("remainingRisks", event.target.value)} /></Field>
          <Field label="다음에 다르게 할 점" required error={errors.retrospective}><textarea value={values.retrospective} onChange={(event) => change("retrospective", event.target.value)} /></Field>
        </div>
        <footer><button type="button" onClick={onCancel}>취소</button><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "완료 기록 저장 중…" : "기록하고 완료"}</button></footer>
      </form>
    </div>
  );
}

function Field({ label, required = false, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return <label className={error ? "has-error" : ""}><span>{label}{required && <em>필수</em>}</span>{children}{error && <small role="alert">{error}</small>}</label>;
}
