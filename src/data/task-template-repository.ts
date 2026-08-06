import { getDatabase } from "./database";

export interface TaskTemplate {
  id: string;
  title: string;
  titleTokens: string[];
  jiraProjectKey: string | null;
  sourceSignature: string | null;
  sourceWorkItemId: string | null;
  adoptionCount: number;
  checklist: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplateRecommendation {
  template: TaskTemplate;
  confidence: number;
  reason: string;
  version: string;
}

interface TemplateRow {
  id: string;
  title: string;
  title_tokens: string;
  jira_project_key: string | null;
  source_signature: string | null;
  source_work_item_id: string | null;
  adoption_count: number;
  created_at: string;
  updated_at: string;
}

export function normalizeTitleTokens(title: string): string[] {
  return [...new Set(title.toLocaleLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))]
    .sort();
}

function similarity(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

async function checklistForTemplate(id: string): Promise<string[]> {
  const database = await getDatabase();
  const rows = await database.select<Array<{ label: string }>>(
    `SELECT label FROM task_template_checklist_items
     WHERE template_id = $1 ORDER BY position, id`, [id],
  );
  return rows.map(({ label }) => label);
}

async function mapTemplate(row: TemplateRow): Promise<TaskTemplate> {
  let titleTokens: string[];
  try {
    const parsed: unknown = JSON.parse(row.title_tokens);
    titleTokens = Array.isArray(parsed) && parsed.every((token) => typeof token === "string")
      ? parsed : normalizeTitleTokens(row.title);
  } catch {
    titleTokens = normalizeTitleTokens(row.title);
  }
  return {
    id: row.id,
    title: row.title,
    titleTokens,
    jiraProjectKey: row.jira_project_key,
    sourceSignature: row.source_signature,
    sourceWorkItemId: row.source_work_item_id,
    adoptionCount: row.adoption_count,
    checklist: await checklistForTemplate(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveTaskTemplate(input: {
  title: string;
  checklist: string[];
  sourceWorkItemId?: string | null;
  jiraProjectKey?: string | null;
  sourceSignature?: string | null;
}): Promise<string> {
  const title = input.title.trim();
  const checklist = input.checklist.map((item) => item.trim()).filter(Boolean).slice(0, 50);
  if (!title || checklist.length === 0) throw new Error("템플릿 제목과 체크리스트가 필요합니다.");
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO task_templates(
      id, title, title_tokens, jira_project_key, source_signature,
      source_work_item_id, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
    [id, title, JSON.stringify(normalizeTitleTokens(title)),
      input.jiraProjectKey?.trim().toUpperCase() || null,
      input.sourceSignature?.trim() || null, input.sourceWorkItemId ?? null, now],
  );
  for (const [position, label] of checklist.entries()) {
    await database.execute(
      `INSERT INTO task_template_checklist_items(id, template_id, label, position, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), id, label, position, now],
    );
  }
  return id;
}

export async function listTaskTemplates(limit = 100): Promise<TaskTemplate[]> {
  const database = await getDatabase();
  const rows = await database.select<TemplateRow[]>(
    `SELECT id, title, title_tokens, jira_project_key, source_signature,
      source_work_item_id, adoption_count, created_at, updated_at
     FROM task_templates ORDER BY updated_at DESC, id DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return Promise.all(rows.map(mapTemplate));
}

export async function recommendTaskTemplates(input: {
  workItemId: string;
  title: string;
  jiraProjectKey?: string | null;
  sourceSignature?: string | null;
  minimumConfidence?: number;
}): Promise<TaskTemplateRecommendation[]> {
  const database = await getDatabase();
  const rows = await database.select<TemplateRow[]>(
    `SELECT id, title, title_tokens, jira_project_key, source_signature,
      source_work_item_id, adoption_count, created_at, updated_at
     FROM task_templates ORDER BY adoption_count DESC, updated_at DESC LIMIT 500`,
  );
  const tokens = normalizeTitleTokens(input.title);
  const recommendations: TaskTemplateRecommendation[] = [];
  for (const row of rows) {
    const template = await mapTemplate(row);
    const version = template.updatedAt;
    const [decision] = await database.select<Array<{ decision: string }>>(
      `SELECT decision FROM template_recommendation_decisions
       WHERE work_item_id = $1 AND template_id = $2 AND template_version = $3`,
      [input.workItemId, template.id, version],
    );
    if (decision) continue;
    const titleScore = similarity(tokens, template.titleTokens);
    const projectMatch = Boolean(input.jiraProjectKey && template.jiraProjectKey
      && input.jiraProjectKey.toUpperCase() === template.jiraProjectKey);
    const sourceMatch = Boolean(input.sourceSignature && template.sourceSignature
      && input.sourceSignature === template.sourceSignature);
    const confidence = Math.min(1, titleScore * 0.7 + (projectMatch ? 0.2 : 0) + (sourceMatch ? 0.1 : 0));
    if (confidence < (input.minimumConfidence ?? 0.45)) continue;
    const reason = [
      titleScore > 0 ? `제목 키워드 ${Math.round(titleScore * 100)}% 일치` : null,
      projectMatch ? "같은 Jira 프로젝트" : null,
      sourceMatch ? "같은 소스 조합" : null,
    ].filter(Boolean).join(" · ");
    recommendations.push({ template, confidence, reason, version });
  }
  return recommendations.sort((left, right) => right.confidence - left.confidence).slice(0, 3);
}

export async function adoptTemplateChecklist(input: {
  workItemId: string;
  templateId: string;
  templateVersion: string;
}): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const decision = await database.execute(
    `INSERT INTO template_recommendation_decisions(
      id, work_item_id, template_id, template_version, decision, created_at
    ) VALUES ($1,$2,$3,$4,'accepted',$5)
    ON CONFLICT(work_item_id, template_id, template_version) DO NOTHING`,
    [crypto.randomUUID(), input.workItemId, input.templateId, input.templateVersion, now],
  );
  if (decision.rowsAffected === 0) return;
  await database.execute(
    `INSERT INTO work_item_checklist_items(
      id, work_item_id, template_id, label, position, created_at
    )
    SELECT lower(hex(randomblob(16))), $1, t.template_id, t.label, t.position, $2
    FROM task_template_checklist_items t
    WHERE t.template_id = $3 AND NOT EXISTS (
      SELECT 1 FROM work_item_checklist_items w
      WHERE w.work_item_id = $1 AND w.template_id = $3 AND w.label = t.label
    )`,
    [input.workItemId, now, input.templateId],
  );
  await database.execute(
    "UPDATE task_templates SET adoption_count = adoption_count + 1 WHERE id = $1",
    [input.templateId],
  );
}

export async function rejectTemplateRecommendation(input: {
  workItemId: string;
  templateId: string;
  templateVersion: string;
}): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO template_recommendation_decisions(
      id, work_item_id, template_id, template_version, decision, created_at
    ) VALUES ($1,$2,$3,$4,'rejected',$5)
    ON CONFLICT(work_item_id, template_id, template_version) DO NOTHING`,
    [crypto.randomUUID(), input.workItemId, input.templateId,
      input.templateVersion, new Date().toISOString()],
  );
}
