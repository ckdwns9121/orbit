import { describe, expect, test } from "bun:test";
import {
  isStretchReminderDue,
  nextStretchReminderAt,
  stretchReminderPreferencesFromStored,
} from "./stretch-reminder";

describe("stretch reminder schedule", () => {
  test("uses a safe default for missing or unsupported intervals", () => {
    expect(stretchReminderPreferencesFromStored({}).intervalMinutes).toBe(60);
    expect(stretchReminderPreferencesFromStored({ stretch_reminder_interval_minutes: "17" }).intervalMinutes).toBe(60);
  });

  test("schedules the next reminder from now without replaying missed intervals", () => {
    expect(nextStretchReminderAt(new Date("2026-08-13T00:00:00.000Z"), 45))
      .toBe("2026-08-13T00:45:00.000Z");
  });

  test("only enabled schedules with a reached next time are due", () => {
    const now = new Date("2026-08-13T01:00:00.000Z");
    expect(isStretchReminderDue({ enabled: true, intervalMinutes: 60, nextAt: "2026-08-13T00:59:00.000Z" }, now)).toBe(true);
    expect(isStretchReminderDue({ enabled: false, intervalMinutes: 60, nextAt: "2026-08-13T00:59:00.000Z" }, now)).toBe(false);
    expect(isStretchReminderDue({ enabled: true, intervalMinutes: 60, nextAt: null }, now)).toBe(false);
  });
});
