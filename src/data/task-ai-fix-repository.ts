import { invoke } from "@tauri-apps/api/core";
import type { WorkItem } from "../domain/work-item";
import { validateTaskAiFixPlan, type TaskAiFixPlan } from "../domain/task-ai-fix";
import { listCalendarEvents } from "./calendar-event-repository";
import { getAppSettings } from "./settings-repository";

export async function generateTaskAiFixPlan(items: WorkItem[]): Promise<TaskAiFixPlan> {
  const tasks = items.filter(({ status }) => status !== "done");
  if (tasks.length === 0) throw new Error("정리할 미완료 Task가 없습니다.");

  const now = new Date();
  const calendarEnd = new Date(now);
  calendarEnd.setDate(calendarEnd.getDate() + 8);
  const [settings, events] = await Promise.all([
    getAppSettings(),
    listCalendarEvents(now, calendarEnd),
  ]);
  const result = await invoke<TaskAiFixPlan>("prioritize_work_items", {
    model: settings.openai_model || null,
    tasks: tasks.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.goal,
      status: item.status,
      priority: item.priority,
      createdAt: item.createdAt,
      targetAt: item.targetAt,
    })),
    calendarEvents: events.slice(0, 80).map((event) => ({
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
    })),
    localNow: `${now.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })} +09:00`,
  });
  return validateTaskAiFixPlan(result, tasks.map(({ id }) => id), now);
}
