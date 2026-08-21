import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { Clipboard, FileCode2, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import type { AiSession } from "../../../../entities/work-context/model/ai-session";
import { displaySessionPrompt, displaySessionTitle } from "../../../../entities/work-context/model/ai-session";
import type { JiraIssueDevelopment } from "../../../../entities/work-context/model/jira-development";
import type { WorkItem } from "../../../../entities/work-context/model/work-item";
import type { WorkItemLink } from "../../../../entities/work-context/model/work-item-link";
import {
  taskWorkflowHandoffMarkdown,
  taskWorkflowStage,
  unresolvedWorkflowQuestions,
  type TaskWorkflowDocument,
  type TaskWorkflowPlan,
  type TaskWorkflowProgress,
  type WorkflowVerificationStatus,
} from "../../../../entities/work-context/model/task-workflow";
import {
  getTaskWorkflow,
  saveGeneratedTaskWorkflow,
  updateTaskWorkflowProgress,
} from "../../../../entities/work-context/api/task-workflow-repository";
import { getAppSettings } from "../../../../entities/work-context/api/settings-repository";
import "./style.scss";

type WorkflowView = "plan" | "verification" | "handoff";

const stageLabel = {
  questions: "질문 확인 필요", review: "계획 승인 대기", implementation: "구현 진행 중",
  verification: "검증 진행 중", handoff: "인수인계 준비됨",
};

export default function TaskWorkflow({ item, links, sessions, development }: {
  item: WorkItem;
  links: WorkItemLink[];
  sessions: AiSession[];
  development: JiraIssueDevelopment[];
}) {
  const [workflow, setWorkflow] = useState<TaskWorkflowDocument | null>(null);
  const [view, setView] = useState<WorkflowView>("plan");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [verificationDrafts, setVerificationDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void getTaskWorkflow(item.id).then((document) => {
      if (!active) return;
      setWorkflow(document);
      setQuestionDrafts(document?.progress.questionAnswers || {});
      setVerificationDrafts(Object.fromEntries(Object.entries(document?.progress.verification || {}).map(([label, result]) => [label, result.evidence])));
    }).catch((cause) => active && setError(String(cause))).finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [item.id]);

  const sourceSnapshot = useMemo(() => [
    ...links.map((link) => ({ kind: link.kind, label: link.label, url: link.externalUrl })),
    ...sessions.map((session) => ({ kind: `ai_${session.provider}`, label: displaySessionTitle(session), url: null })),
    ...development.map((entry) => ({ kind: "jira_development", label: `${entry.issue.key} · ${entry.issue.summary}`, url: entry.issue.url })),
  ], [development, links, sessions]);

  async function refreshDocument() {
    const document = await getTaskWorkflow(item.id);
    setWorkflow(document);
    setQuestionDrafts(document?.progress.questionAnswers || {});
    setVerificationDrafts(Object.fromEntries(Object.entries(document?.progress.verification || {}).map(([label, result]) => [label, result.evidence])));
  }

  async function generatePlan() {
    if (workflow && !window.confirm("계획을 다시 만들까요? 같은 항목의 기록은 보존되지만 계획 승인은 해제됩니다.")) return;
    setIsGenerating(true); setError(null); setNotice(null);
    try {
      const settings = await getAppSettings();
      const model = settings.openai_model?.trim() || "gpt-5.6-luna";
      const plan = await invoke<TaskWorkflowPlan>("generate_task_workflow_plan", {
        taskTitle: item.title,
        taskDescription: item.goal || item.doneDefinition || null,
        context: buildWorkflowContext(item, links, sessions, development),
        model,
      });
      await saveGeneratedTaskWorkflow({ workItemId: item.id, plan, sources: sourceSnapshot, model });
      await refreshDocument();
      setView("plan");
      setNotice("연결된 근거를 바탕으로 실행 계획을 만들었습니다. 미해결 질문을 확인해주세요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveProgress(next: TaskWorkflowProgress, message?: string) {
    if (!workflow || isSaving) return;
    setError(null);
    setIsSaving(true);
    try {
      await updateTaskWorkflowProgress(item.id, workflow.revision, next);
      await refreshDocument();
      if (message) setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refreshDocument();
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <section className="task-workflow-shell"><p>저장된 실행 워크플로를 확인하고 있어요…</p></section>;
  const unresolved = workflow ? unresolvedWorkflowQuestions(workflow) : [];
  const stage = workflow ? taskWorkflowStage(workflow) : null;

  return <section className="task-workflow-shell" aria-label="Task 실행 워크플로" aria-busy={isGenerating || isSaving}>
    <header className="task-workflow-heading">
      <i><Sparkles size={16} aria-hidden="true" /></i>
      <span><small>CONTEXT TO DELIVERY</small><strong>Task 실행 워크플로</strong><em>{workflow ? `${stageLabel[stage!]} · 근거 ${workflow.sources.length}개` : "계획을 만들면 작업 전 과정을 이어서 관리합니다."}</em></span>
          <button type="button" onClick={() => void generatePlan()} disabled={isGenerating || isSaving}>
        {workflow ? <RefreshCw size={13} /> : <Sparkles size={13} />}{isGenerating ? "생성 중…" : workflow ? "다시 만들기" : "AI 계획 만들기"}
      </button>
    </header>

    {!workflow && <div className="task-workflow-empty"><ListChecks size={22} /><strong>컨텍스트를 실행 가능한 계획으로 바꾸세요</strong><p>요구사항, 영향 범위, 체크리스트와 미해결 질문을 만들고 검증 근거와 PR 인수인계까지 이어갑니다.</p></div>}

    {workflow && <>
      <nav className="task-workflow-tabs" aria-label="Task 워크플로 단계">
        <button className={view === "plan" ? "active" : ""} type="button" onClick={() => setView("plan")}>계획{unresolved.length > 0 && <span>{unresolved.length}</span>}</button>
        <button className={view === "verification" ? "active" : ""} type="button" onClick={() => setView("verification")}>검증</button>
        <button className={view === "handoff" ? "active" : ""} type="button" onClick={() => setView("handoff")}>인수인계</button>
      </nav>

      {view === "plan" && <div className="task-workflow-plan">
        <WorkflowCopy title="요구사항 요약" content={workflow.plan.requirementSummary} />
        <WorkflowCopy title="프런트엔드 영향" content={workflow.plan.frontendImpact} />
        {workflow.plan.files.length > 0 && <div className="task-workflow-files"><strong><FileCode2 size={13} /> 예상 파일</strong>{workflow.plan.files.map((file) => <code key={file}>{file}</code>)}</div>}
        {workflow.plan.openQuestions.length > 0 && <div className="task-workflow-questions"><header><strong>미해결 질문</strong><span>{unresolved.length}개 남음</span></header>{workflow.plan.openQuestions.map((question) => <label key={question}><span>{question}</span><div><input value={questionDrafts[question] || ""} disabled={isSaving} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question]: event.target.value }))} placeholder="확정된 답변을 기록하세요" /><button type="button" disabled={isSaving || !questionDrafts[question]?.trim()} onClick={() => void saveProgress({ ...workflow.progress, questionAnswers: { ...workflow.progress.questionAnswers, [question]: questionDrafts[question] } }, "질문 답변을 저장했습니다.")}>{workflow.progress.questionAnswers[question] ? "수정" : "저장"}</button></div></label>)}</div>}
        <div className="task-workflow-approval"><span><strong>{workflow.progress.approvedAt ? "계획 승인됨" : unresolved.length ? "질문 해결 후 승인 가능" : "구현 전 계획을 검토해주세요"}</strong><small>{workflow.progress.approvedAt ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(workflow.progress.approvedAt)) : "승인 후 구현 체크리스트가 활성화됩니다."}</small></span>{!workflow.progress.approvedAt && <button className="primary-button" type="button" disabled={isSaving || unresolved.length > 0} onClick={() => void saveProgress({ ...workflow.progress, approvedAt: new Date().toISOString() }, "실행 계획을 승인했습니다.")}>계획 승인</button>}</div>
        <WorkflowChecklist title="구현 체크리스트" items={workflow.plan.implementationChecklist} completed={workflow.progress.implementationDone} disabled={!workflow.progress.approvedAt || isSaving} onToggle={(label) => void saveProgress({ ...workflow.progress, implementationDone: workflow.progress.implementationDone.includes(label) ? workflow.progress.implementationDone.filter((item) => item !== label) : [...workflow.progress.implementationDone, label] })} />
      </div>}

      {view === "verification" && <div className="task-workflow-verification">
        <p>각 검증의 결과와 재현 가능한 근거를 남기세요. 실패 항목은 인수인계 위험으로 표시됩니다.</p>
        {workflow.plan.testChecklist.map((label) => {
          const result = workflow.progress.verification[label] || { status: "pending" as const, evidence: "" };
          return <article key={label}><strong>{label}</strong><div className="task-workflow-statuses">{(["pending", "passed", "failed", "manual"] as WorkflowVerificationStatus[]).map((status) => <button className={result.status === status ? `active ${status}` : ""} type="button" key={status} disabled={isSaving} onClick={() => void saveProgress({ ...workflow.progress, verification: { ...workflow.progress.verification, [label]: { status, evidence: verificationDrafts[label] ?? result.evidence } } })}>{verificationLabel[status]}</button>)}</div><div className="task-workflow-evidence"><input value={verificationDrafts[label] ?? result.evidence} disabled={isSaving} onChange={(event) => setVerificationDrafts((current) => ({ ...current, [label]: event.target.value }))} placeholder="명령, 테스트 결과, 스크린샷 메모 등" /><button type="button" disabled={isSaving} onClick={() => void saveProgress({ ...workflow.progress, verification: { ...workflow.progress.verification, [label]: { ...result, evidence: verificationDrafts[label] ?? result.evidence } } }, "검증 근거를 저장했습니다.")}>근거 저장</button></div></article>;
        })}
        {workflow.plan.testChecklist.length === 0 && <div className="task-workflow-empty compact">생성된 검증 항목이 없습니다. 계획을 다시 만들어보세요.</div>}
      </div>}

      {view === "handoff" && <WorkflowHandoff title={item.title} workflow={workflow} onCopied={() => setNotice("PR 인수인계 Markdown을 복사했습니다.")} />}
    </>}
    {notice && <p className="task-workflow-notice" role="status">{notice}</p>}
    {error && <p className="task-workflow-error" role="alert">{error}</p>}
  </section>;
}

const verificationLabel: Record<WorkflowVerificationStatus, string> = { pending: "대기", passed: "통과", failed: "실패", manual: "수동 확인" };

function WorkflowCopy({ title, content }: { title: string; content: string }) {
  return <div className="task-workflow-copy"><strong>{title}</strong><p>{content}</p></div>;
}

function WorkflowChecklist({ title, items, completed, disabled, onToggle }: { title: string; items: string[]; completed: string[]; disabled: boolean; onToggle: (label: string) => void }) {
  return <div className="task-workflow-checklist"><header><strong>{title}</strong><span>{completed.length}/{items.length}</span></header>{items.map((label) => <label className={completed.includes(label) ? "done" : ""} key={label}><input type="checkbox" checked={completed.includes(label)} disabled={disabled} onChange={() => onToggle(label)} /><span>{label}</span></label>)}{items.length === 0 && <p>생성된 항목이 없습니다.</p>}</div>;
}

function WorkflowHandoff({ title, workflow, onCopied }: { title: string; workflow: TaskWorkflowDocument; onCopied: () => void }) {
  const markdown = taskWorkflowHandoffMarkdown(title, workflow);
  return <div className="task-workflow-handoff"><header><span><strong>PR 인수인계 초안</strong><small>계획과 현재 검증 기록에서 자동 구성됩니다.</small></span><button type="button" onClick={() => void navigator.clipboard.writeText(markdown).then(onCopied)}><Clipboard size={13} /> Markdown 복사</button></header><pre>{markdown}</pre></div>;
}

function buildWorkflowContext(item: WorkItem, links: WorkItemLink[], sessions: AiSession[], development: JiraIssueDevelopment[]): string {
  const values = [
    `[Task]\n제목: ${item.title}\n설명: ${item.goal || "없음"}\n다음 행동: ${item.nextAction || "없음"}\n완료 조건: ${item.doneDefinition || "없음"}`,
    `[연결 링크]\n${links.map((link) => `- ${link.kind}: ${link.label}${link.externalUrl ? ` (${link.externalUrl})` : ""}`).join("\n") || "없음"}`,
    `[AI 세션]\n${sessions.map((session) => `- ${session.provider}: ${displaySessionTitle(session)} | 시작=${displaySessionPrompt(session.firstPrompt)} | 최근=${displaySessionPrompt(session.lastPrompt)}`).join("\n") || "없음"}`,
    `[Jira와 개발 정보]\n${development.map((entry) => [
      `${entry.issue.key} ${entry.issue.summary} (${entry.issue.status})`,
      ...entry.branches.map((branch) => `branch ${branch.repository}:${branch.name}`),
      ...entry.commits.map((commit) => `commit ${commit.repository}:${commit.message}`),
      ...entry.pullRequests.map((pullRequest) => `PR ${pullRequest.repository}#${pullRequest.number}: ${pullRequest.title}`),
      ...entry.builds.map((build) => `build ${build.name}: ${build.conclusion || build.status}`),
    ].join("\n")).join("\n") || "없음"}`,
  ];
  return values.join("\n\n").slice(0, 40_000);
}
