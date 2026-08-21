import { describe, expect, test } from "bun:test";
import {
  normalizeTaskWorkflowPlan,
  normalizeTaskWorkflowProgress,
  taskWorkflowHandoffMarkdown,
  taskWorkflowStage,
  type TaskWorkflowDocument,
} from "./task-workflow";

const plan = normalizeTaskWorkflowPlan({
  requirementSummary: "필터 상태를 URL에 보존한다.",
  frontendImpact: "목록 화면과 URL 상태 훅을 변경한다.",
  files: ["src/list.tsx"],
  implementationChecklist: ["URL 상태 훅 연결", "빈 상태 구현"],
  testChecklist: ["새로고침 후 필터 유지", "빈 결과 화면 확인"],
  openQuestions: ["초기 필터의 기본값은 무엇인가?"],
});

function document(progress: TaskWorkflowDocument["progress"]): TaskWorkflowDocument {
  return { workItemId: "task-1", plan, progress, sources: [], model: "test", revision: 1, generatedAt: "2026-08-21T00:00:00Z", updatedAt: "2026-08-21T00:00:00Z" };
}

describe("Task 실행 워크플로", () => {
  test("질문 해결과 사람의 승인 전에는 구현 단계로 넘어가지 않는다", () => {
    const initial = normalizeTaskWorkflowProgress({}, plan);
    expect(taskWorkflowStage(document(initial))).toBe("questions");
    const answered = normalizeTaskWorkflowProgress({ questionAnswers: { [plan.openQuestions[0]]: "전체 상태" } }, plan);
    expect(taskWorkflowStage(document(answered))).toBe("review");
    expect(taskWorkflowStage(document({ ...answered, approvedAt: "2026-08-21T01:00:00Z" }))).toBe("implementation");
  });

  test("구현과 검증 기록을 완료하면 인수인계 단계가 된다", () => {
    const progress = normalizeTaskWorkflowProgress({
      approvedAt: "2026-08-21T01:00:00Z",
      questionAnswers: { [plan.openQuestions[0]]: "전체 상태" },
      implementationDone: plan.implementationChecklist,
      verification: Object.fromEntries(plan.testChecklist.map((item) => [item, { status: "passed", evidence: "bun test" }])),
    }, plan);
    const workflow = document(progress);
    expect(taskWorkflowStage(workflow)).toBe("handoff");
    const markdown = taskWorkflowHandoffMarkdown("필터 개선", workflow);
    expect(markdown).toContain("## Verification");
    expect(markdown).toContain("bun test");
    expect(markdown).toContain("기록된 미해결 위험 없음");
  });

  test("계획 재생성 후 사라진 항목의 진행 기록은 제거한다", () => {
    const progress = normalizeTaskWorkflowProgress({
      implementationDone: ["URL 상태 훅 연결", "사라진 작업"],
      questionAnswers: { "사라진 질문": "답변" },
      verification: { "새로고침 후 필터 유지": { status: "passed", evidence: "통과" }, "사라진 테스트": { status: "failed" } },
    }, plan);
    expect(progress.implementationDone).toEqual(["URL 상태 훅 연결"]);
    expect(progress.questionAnswers).toEqual({});
    expect(Object.keys(progress.verification)).toEqual(plan.testChecklist);
  });
});
