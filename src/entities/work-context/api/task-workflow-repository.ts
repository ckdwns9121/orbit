import {
  emptyTaskWorkflowProgress,
  normalizeTaskWorkflowPlan,
  normalizeTaskWorkflowProgress,
  type TaskWorkflowDocument,
  type TaskWorkflowPlan,
  type TaskWorkflowProgress,
  type TaskWorkflowSource,
} from "../model/task-workflow";
import { getDatabase } from "./database";

interface WorkflowRow {
  work_item_id: string; plan_json: string; progress_json: string; source_snapshot_json: string;
  model: string; revision: number; generated_at: string; updated_at: string;
}

const parse = (value: string): unknown => { try { return JSON.parse(value); } catch { return null; } };

function mapWorkflow(row: WorkflowRow): TaskWorkflowDocument {
  const plan = normalizeTaskWorkflowPlan(parse(row.plan_json));
  return {
    workItemId: row.work_item_id,
    plan,
    progress: normalizeTaskWorkflowProgress(parse(row.progress_json), plan),
    sources: Array.isArray(parse(row.source_snapshot_json)) ? parse(row.source_snapshot_json) as TaskWorkflowSource[] : [],
    model: row.model, revision: row.revision, generatedAt: row.generated_at, updatedAt: row.updated_at,
  };
}

export async function getTaskWorkflow(workItemId: string): Promise<TaskWorkflowDocument | null> {
  const database = await getDatabase();
  const rows = await database.select<WorkflowRow[]>("SELECT * FROM work_item_workflows WHERE work_item_id = $1 LIMIT 1", [workItemId]);
  return rows[0] ? mapWorkflow(rows[0]) : null;
}

export async function saveGeneratedTaskWorkflow(input: {
  workItemId: string; plan: TaskWorkflowPlan; sources: TaskWorkflowSource[]; model: string;
}): Promise<void> {
  const database = await getDatabase();
  const plan = normalizeTaskWorkflowPlan(input.plan);
  if (!plan.requirementSummary || !plan.frontendImpact) throw new Error("실행 계획에 요구사항과 영향 범위가 필요합니다.");
  const existing = await getTaskWorkflow(input.workItemId);
  const previous = existing?.progress ?? emptyTaskWorkflowProgress();
  const progress = normalizeTaskWorkflowProgress({ ...previous, approvedAt: null }, plan);
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO work_item_workflows(work_item_id,plan_json,progress_json,source_snapshot_json,model,revision,generated_at,updated_at)
     VALUES($1,$2,$3,$4,$5,1,$6,$6)
     ON CONFLICT(work_item_id) DO UPDATE SET plan_json=excluded.plan_json,
       progress_json=excluded.progress_json,source_snapshot_json=excluded.source_snapshot_json,
       model=excluded.model,revision=work_item_workflows.revision+1,
       generated_at=excluded.generated_at,updated_at=excluded.updated_at`,
    [input.workItemId, JSON.stringify(plan), JSON.stringify(progress), JSON.stringify(input.sources.slice(0, 100)), input.model, now],
  );
}

export async function updateTaskWorkflowProgress(workItemId: string, expectedRevision: number, progress: TaskWorkflowProgress): Promise<void> {
  const document = await getTaskWorkflow(workItemId);
  if (!document) throw new Error("저장된 Task 실행 계획이 없습니다.");
  const normalized = normalizeTaskWorkflowProgress(progress, document.plan);
  const result = await (await getDatabase()).execute(
    "UPDATE work_item_workflows SET progress_json=$1,revision=revision+1,updated_at=$2 WHERE work_item_id=$3 AND revision=$4",
    [JSON.stringify(normalized), new Date().toISOString(), workItemId, expectedRevision],
  );
  if (result.rowsAffected !== 1) throw new Error("실행 계획이 다른 화면에서 변경되었습니다. 최신 기록을 다시 불러왔습니다.");
}
