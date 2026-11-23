import { describe, expect, test } from "bun:test";

import { localDateAt, localPartsAt, zonedTimeToEpoch } from "../platform/local-time.ts";
import { DEFAULT_SEND_WINDOW, nextSendSlot, parseSendWindow, planSlots } from "./planning.ts";

const SPACING_MS = 20 * 60_000;

function slotsAt(now: number, timeZone: string, count: number, blocked: number[] = []) {
  return planSlots({
    blocked,
    count,
    now,
    random: () => 0.5,
    spacingMs: SPACING_MS,
    timeZone,
    window: DEFAULT_SEND_WINDOW,
  });
}

function localHour(at: number, timeZone: string) {
  return localPartsAt(at, timeZone).hour;
}

describe("parseSendWindow", () => {
  test("reads the admin setting and falls back when it is malformed", () => {
    expect(parseSendWindow('{"start":"09:30","end":"18:00"}')).toEqual({
      endMinutes: 18 * 60,
      startMinutes: 9 * 60 + 30,
    });

    expect(parseSendWindow("{not json")).toEqual(DEFAULT_SEND_WINDOW);
    expect(parseSendWindow('{"start":"20:00","end":"08:00"}')).toEqual(DEFAULT_SEND_WINDOW);
    expect(parseSendWindow(null)).toEqual(DEFAULT_SEND_WINDOW);
  });

  test("reads a whole-day window that ends at midnight", () => {
    const window = parseSendWindow('{"start":"00:00","end":"24:00"}');
    const lastMinute = Date.UTC(2026, 2, 10, 23, 59);

    expect(window).toEqual({ endMinutes: 24 * 60, startMinutes: 0 });
    expect(nextSendSlot(lastMinute, "UTC", window)).toBe(lastMinute);
  });
});

describe("planSlots", () => {
  test("places slots inside 08:00-20:00 and after the current time", () => {
    const now = Date.UTC(2026, 2, 10, 12, 0);
    const slots = slotsAt(now, "UTC", 5);

    expect(slots.length).toBe(5);

    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(now);
      expect(localHour(slot, "UTC")).toBeGreaterThanOrEqual(8);
      expect(localHour(slot, "UTC")).toBeLessThan(20);
    }
  });

  test("waits for the window when the planner runs at local midnight", () => {
    const now = Date.UTC(2026, 2, 10, 0, 30);
    const windowStart = zonedTimeToEpoch({ day: 10, month: 3, year: 2026 }, 8, 0, "UTC");
    const slots = slotsAt(now, "UTC", 3);

    expect(slots.length).toBe(3);

    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(windowStart);
    }
  });

  test("rolls to the next day when the window has closed", () => {
    const now = Date.UTC(2026, 2, 10, 21, 0);
    const slots = slotsAt(now, "UTC", 3);

    expect(slots.length).toBe(3);

    for (const slot of slots) {
      expect(slot).toBeGreaterThan(now);
      expect(localDateAt(slot, "UTC")).toEqual({ day: 11, month: 3, year: 2026 });
    }
  });

  test("keeps every pair of slots at least twenty minutes apart", () => {
    const slots = slotsAt(Date.UTC(2026, 2, 10, 8, 0), "UTC", 10);

    expect(slots.length).toBe(10);

    for (let index = 1; index < slots.length; index += 1) {
      const previous = slots[index - 1] ?? 0;
      const current = slots[index] ?? 0;

      expect(current - previous).toBeGreaterThanOrEqual(SPACING_MS);
    }
  });

  test("never plans more slots than the remaining window can space", () => {
    const now = Date.UTC(2026, 2, 10, 19, 30);
    const slots = slotsAt(now, "UTC", 10);

    expect(slots.length).toBe(2);

    for (let index = 1; index < slots.length; index += 1) {
      expect((slots[index] ?? 0) - (slots[index - 1] ?? 0)).toBeGreaterThanOrEqual(SPACING_MS);
    }
  });

  test("keeps existing slots apart when new Applications join the day", () => {
    const blocked = [Date.UTC(2026, 2, 10, 12, 0)];
    const slots = slotsAt(Date.UTC(2026, 2, 10, 10, 0), "UTC", 3, blocked);

    expect(slots.length).toBe(3);

    for (const slot of slots) {
      expect(Math.abs(slot - (blocked[0] ?? 0))).toBeGreaterThanOrEqual(SPACING_MS);
    }
  });

  test("follows the local window across a spring-forward change", () => {
    const timeZone = "America/Toronto";
    const now = zonedTimeToEpoch({ day: 8, month: 3, year: 2026 }, 7, 0, timeZone);
    const slots = slotsAt(now, timeZone, 3);

    expect(slots.length).toBe(3);

    for (const slot of slots) {
      expect(localDateAt(slot, timeZone)).toEqual({ day: 8, month: 3, year: 2026 });
      expect(localHour(slot, timeZone)).toBeGreaterThanOrEqual(8);
      expect(localHour(slot, timeZone)).toBeLessThan(20);
    }
  });

  test("follows the local window across a fall-back change", () => {
    const timeZone = "America/Toronto";
    const now = zonedTimeToEpoch({ day: 1, month: 11, year: 2026 }, 7, 0, timeZone);
    const slots = slotsAt(now, timeZone, 3);

    expect(slots.length).toBe(3);

    for (const slot of slots) {
      expect(localDateAt(slot, timeZone)).toEqual({ day: 1, month: 11, year: 2026 });
      expect(localHour(slot, timeZone)).toBeGreaterThanOrEqual(8);
      expect(localHour(slot, timeZone)).toBeLessThan(20);
    }
  });
});
