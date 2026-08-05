import { describe, expect, test } from "bun:test";
import { normalizeGoogleEvent, shouldAutoSyncGoogleCalendar } from "./google-calendar-repository";

const baseEvent = {
  id: "event-1", title: "회의", status: "confirmed", htmlLink: null,
  location: null, notes: null, updated: null,
};

describe("Google Calendar event normalization", () => {
  test("keeps timed event instants", () => {
    const result = normalizeGoogleEvent({
      ...baseEvent,
      startDateTime: "2026-08-05T10:00:00+09:00", endDateTime: "2026-08-05T11:00:00+09:00",
      startDate: null, endDate: null,
    });
    expect(result).toEqual({ startAt: "2026-08-05T01:00:00.000Z", endAt: "2026-08-05T02:00:00.000Z", allDay: false });
  });

  test("recognizes date-only events as all-day", () => {
    const result = normalizeGoogleEvent({
      ...baseEvent,
      startDateTime: null, endDateTime: null, startDate: "2026-08-05", endDate: "2026-08-06",
    });
    expect(result?.allDay).toBe(true);
    expect(new Date(result!.startAt).getDate()).toBe(5);
  });

  test("expands zero-duration timed events to one minute", () => {
    const result = normalizeGoogleEvent({
      ...baseEvent,
      startDateTime: "2026-08-05T10:00:00+09:00", endDateTime: "2026-08-05T10:00:00+09:00",
      startDate: null, endDate: null,
    });
    expect(new Date(result!.endAt).getTime() - new Date(result!.startAt).getTime()).toBe(60_000);
  });

  test("expands zero-duration all-day events to one day", () => {
    const result = normalizeGoogleEvent({
      ...baseEvent,
      startDateTime: null, endDateTime: null, startDate: "2026-08-05", endDate: "2026-08-05",
    });
    expect(new Date(result!.endAt).getTime() - new Date(result!.startAt).getTime()).toBe(24 * 60 * 60 * 1_000);
  });
});

test("auto sync waits fifteen minutes", () => {
  const now = new Date("2026-08-05T10:00:00Z").getTime();
  expect(shouldAutoSyncGoogleCalendar({ email: "me@example.com", connectedAt: "", lastSyncedAt: "2026-08-05T09:50:00Z" }, now)).toBe(false);
  expect(shouldAutoSyncGoogleCalendar({ email: "me@example.com", connectedAt: "", lastSyncedAt: "2026-08-05T09:40:00Z" }, now)).toBe(true);
});
