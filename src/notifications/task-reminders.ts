import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { claimDueWorkItemReminders } from "../data/work-item-repository";

export async function requestTaskReminderPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export async function notifyDueWorkItems(): Promise<number> {
  if (!(await isPermissionGranted())) return 0;

  const dueItems = await claimDueWorkItemReminders();
  if (dueItems.length === 0) return 0;

  const body = dueItems.length === 1
    ? `“${dueItems[0].title}”의 목표 시간이 지났습니다.`
    : `${dueItems.slice(0, 3).map(({ title }) => title).join(" · ")}${dueItems.length > 3 ? ` 외 ${dueItems.length - 3}개` : ""}`;

  sendNotification({
    title: dueItems.length === 1
      ? "완료되지 않은 작업이 있어요"
      : `${dueItems.length}개의 작업이 완료되지 않았어요`,
    body,
  });
  return dueItems.length;
}
