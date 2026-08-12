import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getAppSettings, setAppSettings } from "../../../../entities/work-context/api/settings-repository";
import {
  isStretchReminderDue,
  nextStretchReminderAt,
  stretchReminderPreferencesFromStored,
} from "../../../../entities/work-context/model/stretch-reminder";

export async function requestStretchReminderPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export function sendStretchReminderNotification(test = false): void {
  sendNotification({
    title: "스트레칭 시간이에요",
    body: test
      ? "알림이 잘 도착했어요. 잠깐 어깨를 펴볼까요?"
      : "잠깐 자리에서 일어나 목과 어깨를 풀어주세요.",
  });
}

export async function notifyDueStretchReminder(now = new Date()): Promise<boolean> {
  const preferences = stretchReminderPreferencesFromStored(await getAppSettings());
  if (!preferences.enabled) return false;

  if (!preferences.nextAt) {
    await setAppSettings({
      stretch_reminder_next_at: nextStretchReminderAt(now, preferences.intervalMinutes),
    });
    return false;
  }

  if (!isStretchReminderDue(preferences, now) || !(await isPermissionGranted())) return false;

  sendStretchReminderNotification();
  await setAppSettings({
    stretch_reminder_next_at: nextStretchReminderAt(now, preferences.intervalMinutes),
  });
  return true;
}
