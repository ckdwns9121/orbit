export type WorkflowVerificationStatus = "pending" | "passed" | "failed" | "manual";

export interface TaskWorkflowPlan {
  requirementSummary: string;
  frontendImpact: string;
  files: string[];
  implementationChecklist: string[];
  testChecklist: string[];
  openQuestions: string[];
}

export interface WorkflowVerificationResult {
  status: WorkflowVerificationStatus;
  evidence: string;
}

export interface TaskWorkflowProgress {
  approvedAt: string | null;
  implementationDone: string[];
  questionAnswers: Record<string, string>;
  verification: Record<string, WorkflowVerificationResult>;
}

export interface TaskWorkflowSource {
  kind: string;
  label: string;
  url: string | null;
}

export interface TaskWorkflowDocument {
  workItemId: string;
  plan: TaskWorkflowPlan;
  progress: TaskWorkflowProgress;
  sources: TaskWorkflowSource[];
  model: string;
  revision: number;
  generatedAt: string;
  updatedAt: string;
}

const compact = (value: unknown, max: number) => typeof value === "string"
  ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
const strings = (value: unknown, limit: number, max: number) => [...new Set(
  (Array.isArray(value) ? value : []).map((item) => compact(item, max)).filter(Boolean),
)].slice(0, limit);

export function normalizeTaskWorkflowPlan(value: unknown): TaskWorkflowPlan {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    requirementSummary: compact(input.requirementSummary, 4_000),
    frontendImpact: compact(input.frontendImpact, 4_000),
    files: strings(input.files, 30, 500),
    implementationChecklist: strings(input.implementationChecklist, 40, 500),
    testChecklist: strings(input.testChecklist, 40, 500),
    openQuestions: strings(input.openQuestions, 20, 1_000),
  };
}

export function emptyTaskWorkflowProgress(): TaskWorkflowProgress {
  return { approvedAt: null, implementationDone: [], questionAnswers: {}, verification: {} };
}

export function normalizeTaskWorkflowProgress(value: unknown, plan: TaskWorkflowPlan): TaskWorkflowProgress {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const answers = typeof input.questionAnswers === "object" && input.questionAnswers !== null
    ? input.questionAnswers as Record<string, unknown> : {};
  const verification = typeof input.verification === "object" && input.verification !== null
    ? input.verification as Record<string, unknown> : {};
  return {
    approvedAt: typeof input.approvedAt === "string" ? input.approvedAt : null,
    implementationDone: strings(input.implementationDone, 40, 500)
      .filter((label) => plan.implementationChecklist.includes(label)),
    questionAnswers: Object.fromEntries(plan.openQuestions.flatMap((question) => {
      const answer = compact(answers[question], 4_000);
      return answer ? [[question, answer]] : [];
    })),
    verification: Object.fromEntries(plan.testChecklist.map((label) => {
      const raw = typeof verification[label] === "object" && verification[label] !== null
        ? verification[label] as Record<string, unknown> : {};
      const status = ["passed", "failed", "manual"].includes(String(raw.status))
        ? raw.status as WorkflowVerificationStatus : "pending";
      return [label, { status, evidence: compact(raw.evidence, 2_000) }];
    })),
  };
}

export function unresolvedWorkflowQuestions(document: TaskWorkflowDocument): string[] {
  return document.plan.openQuestions.filter((question) => !document.progress.questionAnswers[question]?.trim());
}

export function taskWorkflowStage(document: TaskWorkflowDocument): "questions" | "review" | "implementation" | "verification" | "handoff" {
  if (unresolvedWorkflowQuestions(document).length) return "questions";
  if (!document.progress.approvedAt) return "review";
  if (document.plan.implementationChecklist.some((item) => !document.progress.implementationDone.includes(item))) return "implementation";
  if (document.plan.testChecklist.some((item) => document.progress.verification[item]?.status === "pending")) return "verification";
  return "handoff";
}

export function taskWorkflowHandoffMarkdown(title: string, document: TaskWorkflowDocument): string {
  const unresolved = unresolvedWorkflowQuestions(document);
  const verification = document.plan.testChecklist.map((label) => {
    const result = document.progress.verification[label] || { status: "pending", evidence: "" };
    return `- [${result.status === "passed" || result.status === "manual" ? "x" : " "}] ${label} — ${result.status}${result.evidence ? `: ${result.evidence}` : ""}`;
  });
  return [
    `## Summary\n\n${title}\n\n${document.plan.requirementSummary}`,
    `## Frontend impact\n\n${document.plan.frontendImpact}`,
    `## Changes\n\n${document.plan.implementationChecklist.map((item) => `- [${document.progress.implementationDone.includes(item) ? "x" : " "}] ${item}`).join("\n") || "- 변경 항목 없음"}`,
    `## Verification\n\n${verification.join("\n") || "- 검증 항목 없음"}`,
    `## Open questions\n\n${document.plan.openQuestions.map((question) => `- ${question}: ${document.progress.questionAnswers[question] || "미해결"}`).join("\n") || "- 없음"}`,
    `## Remaining risks\n\n${unresolved.length ? `미해결 질문 ${unresolved.length}개가 남아 있습니다.` : document.plan.testChecklist.some((item) => document.progress.verification[item]?.status === "failed") ? "실패한 검증 항목이 남아 있습니다." : "기록된 미해결 위험 없음"}`,
  ].join("\n\n");
}
