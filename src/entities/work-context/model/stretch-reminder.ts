import type { AppSettings } from "../api/settings-repository";

export const DEFAULT_STRETCH_INTERVAL_MINUTES = 60;
export const STRETCH_INTERVAL_OPTIONS = [20, 30, 45, 60, 90] as const;

export type StretchReminderPreferences = {
  enabled: boolean;
  intervalMinutes: number;
  nextAt: string | null;
};

export function stretchReminderPreferencesFromStored(settings: AppSettings): StretchReminderPreferences {
  const storedInterval = Number(settings.stretch_reminder_interval_minutes);
  const intervalMinutes = STRETCH_INTERVAL_OPTIONS.some((value) => value === storedInterval)
    ? storedInterval
    : DEFAULT_STRETCH_INTERVAL_MINUTES;
  const nextAt = settings.stretch_reminder_next_at;

  return {
    enabled: settings.stretch_reminder_enabled === "true",
    intervalMinutes,
    nextAt: nextAt && Number.isFinite(new Date(nextAt).getTime()) ? nextAt : null,
  };
}

export function nextStretchReminderAt(now: Date, intervalMinutes: number): string {
  return new Date(now.getTime() + intervalMinutes * 60_000).toISOString();
}

export function isStretchReminderDue(preferences: StretchReminderPreferences, now: Date): boolean {
  if (!preferences.enabled || !preferences.nextAt) return false;
  return new Date(preferences.nextAt).getTime() <= now.getTime();
}
