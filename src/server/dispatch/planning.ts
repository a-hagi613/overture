import { z } from "zod";

import {
  addLocalDays,
  localDateAt,
  localDayStartFor,
  localWindowOn,
} from "../platform/local-time.ts";

export interface SendWindow {
  startMinutes: number;
  endMinutes: number;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { endMinutes: 20 * 60, startMinutes: 8 * 60 };

export interface PlanSlotsInput {
  now: number;
  timeZone: string;
  window: SendWindow;
  count: number;
  spacingMs: number;
  blocked: readonly number[];
  random: () => number;
}

const TIME_PATTERN = /^(?<hours>\d{2}):(?<minutes>\d{2})$/u;

const windowSchema = z.object({ start: z.string(), end: z.string() });

function minutesOf(value: string) {
  const match = TIME_PATTERN.exec(value);

  if (match?.groups === undefined) {
    return null;
  }

  const hours = Number(match.groups["hours"]);
  const minutes = Number(match.groups["minutes"]);

  if (hours > 24 || minutes > 59) {
    return null;
  }

  return Math.min(hours * 60 + minutes, 24 * 60);
}

export function parseSendWindow(raw: string | null) {
  if (raw === null) {
    return DEFAULT_SEND_WINDOW;
  }

  let parsed: ReturnType<typeof windowSchema.safeParse>;

  try {
    parsed = windowSchema.safeParse(JSON.parse(raw));
  } catch {
    return DEFAULT_SEND_WINDOW;
  }

  if (!parsed.success) {
    return DEFAULT_SEND_WINDOW;
  }

  const startMinutes = minutesOf(parsed.data.start);
  const endMinutes = minutesOf(parsed.data.end);

  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return DEFAULT_SEND_WINDOW;
  }

  return { endMinutes, startMinutes };
}

export function planningWindow(now: number, timeZone: string, window: SendWindow) {
  const today = localDateAt(now, timeZone);
  const todayStart = localDayStartFor(today, timeZone);
  const nextDayStart = localDayStartFor(addLocalDays(today, 1), timeZone);
  const todayWindow = localWindowOn(today, window.startMinutes, window.endMinutes, timeZone);

  if (now < todayWindow.end) {
    return {
      dayStart: todayStart,
      end: todayWindow.end,
      nextDayStart,
      start: Math.max(now, todayWindow.start),
    };
  }

  const tomorrow = addLocalDays(today, 1);
  const tomorrowWindow = localWindowOn(tomorrow, window.startMinutes, window.endMinutes, timeZone);

  return {
    dayStart: nextDayStart,
    end: tomorrowWindow.end,
    nextDayStart: localDayStartFor(addLocalDays(tomorrow, 1), timeZone),
    start: tomorrowWindow.start,
  };
}

interface Interval {
  start: number;
  end: number;
}

function freeIntervals(start: number, end: number, blocked: readonly number[], spacingMs: number) {
  let intervals: Interval[] = [{ end, start }];

  const relevant = blocked
    .filter((at) => at + spacingMs > start && at - spacingMs < end)
    .toSorted((left, right) => left - right);

  for (const at of relevant) {
    const zoneStart = at - spacingMs;
    const zoneEnd = at + spacingMs;
    const next: Interval[] = [];

    for (const interval of intervals) {
      if (zoneEnd <= interval.start || zoneStart >= interval.end) {
        next.push(interval);

        continue;
      }

      if (zoneStart > interval.start) {
        next.push({ end: zoneStart, start: interval.start });
      }

      if (zoneEnd < interval.end) {
        next.push({ end: interval.end, start: zoneEnd });
      }
    }

    intervals = next;
  }

  return intervals.filter((interval) => interval.end > interval.start);
}

export function planSlots(input: PlanSlotsInput) {
  if (input.count <= 0 || input.spacingMs <= 0) {
    return [];
  }

  const window = planningWindow(input.now, input.timeZone, input.window);

  if (window.end <= window.start) {
    return [];
  }

  const intervals = freeIntervals(window.start, window.end, input.blocked, input.spacingMs);

  const raw: number[] = [];

  for (const interval of intervals) {
    if (raw.length >= input.count) {
      break;
    }

    const capacity = Math.floor((interval.end - interval.start) / input.spacingMs) + 1;
    const take = Math.min(input.count - raw.length, capacity);
    const usable = interval.end - interval.start - (take - 1) * input.spacingMs;
    const band = usable / take;

    for (let index = 0; index < take; index += 1) {
      const offset = interval.start + index * band + input.random() * band;

      raw.push(offset + index * input.spacingMs);
    }
  }

  raw.sort((left, right) => left - right);

  const slots: number[] = [];

  for (const candidate of raw) {
    const at = Math.round(candidate);
    const previous = slots.at(-1);
    const adjusted = previous === undefined ? at : Math.max(at, previous + input.spacingMs);

    if (adjusted <= window.end) {
      slots.push(adjusted);
    }
  }

  return slots;
}
