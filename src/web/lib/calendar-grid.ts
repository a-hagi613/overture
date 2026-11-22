import type { CalendarItem } from "./calendar-api.ts";

export interface CalendarDate {
  day: number;
  month: number;
  year: number;
}

export interface CalendarCell extends CalendarDate {
  inMonth: boolean;
}

export type ChipKind = "sent" | "stage" | "offer" | "closed" | "checkin" | "interview";

const GRID_DAYS = 42;

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(zone: string) {
  const cached = formatters.get(zone);

  if (cached !== undefined) {
    return cached;
  }

  const created = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    second: "numeric",
    timeZone: zone,
    year: "numeric",
  });

  formatters.set(zone, created);

  return created;
}

function wallParts(at: number, zone: string) {
  const parts = new Map<string, number>();

  for (const part of wallFormatter(zone).formatToParts(new Date(at))) {
    parts.set(part.type, Number(part.value));
  }

  return {
    day: parts.get("day") ?? 1,
    hour: parts.get("hour") ?? 0,
    minute: parts.get("minute") ?? 0,
    month: parts.get("month") ?? 1,
    second: parts.get("second") ?? 0,
    year: parts.get("year") ?? 1970,
  };
}

function offsetAt(at: number, zone: string) {
  const wall = wallParts(at, zone);

  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
    Math.trunc(at / 1000) * 1000
  );
}

/**
 * The calendar day an instant falls on in a time zone.
 *
 * @param at Milliseconds since the epoch.
 * @param zone An IANA time zone.
 * @returns The local year, month (1 to 12) and day.
 */
export function dateIn(at: number, zone: string) {
  const { day, month, year } = wallParts(at, zone);

  return { day, month, year };
}

/**
 * The instant a local day begins in a time zone.
 *
 * @param date The local day.
 * @param zone An IANA time zone.
 * @returns Milliseconds since the epoch at local midnight.
 */
export function zonedStart(date: CalendarDate, zone: string) {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  const first = guess - offsetAt(guess, zone);

  return guess - offsetAt(first, zone);
}

export function addDays(date: CalendarDate, days: number) {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return { day: moved.getUTCDate(), month: moved.getUTCMonth() + 1, year: moved.getUTCFullYear() };
}

function pad(value: number, width: number) {
  return String(value).padStart(width, "0");
}

export function dayKeyOf(date: CalendarDate) {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function parseDayKey(key: string) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(key);

  if (match?.groups === undefined) {
    return null;
  }

  const date = {
    day: Number(match.groups["day"]),
    month: Number(match.groups["month"]),
    year: Number(match.groups["year"]),
  };

  return dayKeyOf(addDays(date, 0)) === key ? date : null;
}

export function parseMonthKey(key: string | null) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})$/u.exec(key ?? "");
  const year = Number(match?.groups?.["year"]);
  const month = Number(match?.groups?.["month"]);

  return match === null || month < 1 || month > 12 ? null : { month, year };
}

export function monthKeyOf(date: { month: number; year: number }) {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}`;
}

/**
 * The six Monday-first weeks that show a month, with the days of the
 * neighbouring months that fill them.
 *
 * @param year The year.
 * @param month The month, 1 to 12.
 * @returns Forty-two days in order.
 */
export function monthCells(year: number, month: number) {
  const first = { day: 1, month, year };
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (weekday + 6) % 7;

  return Array.from({ length: GRID_DAYS }, (_, index) => {
    const date = addDays(first, index - lead);

    return { ...date, inMonth: date.month === month && date.year === year };
  });
}

/**
 * The request range for the grid of a month: its 42 local days.
 *
 * @param year The year.
 * @param month The month, 1 to 12.
 * @param zone The zone the days are counted in.
 * @returns The range start and end, in milliseconds.
 */
export function monthRange(year: number, month: number, zone: string) {
  const cells = monthCells(year, month);
  const first = cells[0] ?? { day: 1, month, year };
  const last = cells.at(-1) ?? first;

  return { from: zonedStart(first, zone), to: zonedStart(addDays(last, 1), zone) };
}

export function bucketByDay(items: readonly CalendarItem[], zone: string) {
  const buckets = new Map<string, CalendarItem[]>();

  for (const entry of items.toSorted((left, right) => left.at - right.at)) {
    const key = dayKeyOf(dateIn(entry.at, zone));
    const bucket = buckets.get(key);

    if (bucket === undefined) {
      buckets.set(key, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  return buckets;
}

export function chipKindOf(entry: CalendarItem) {
  if (entry.kind === "sent" || entry.kind === "interview") {
    return entry.kind;
  }

  if (entry.stage === "offer" || entry.stage === "closed") {
    return entry.stage;
  }

  return entry.kind === "checkin" ? "checkin" : "stage";
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function shiftMonth(date: CalendarDate, months: number) {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;

  return { day: Math.min(date.day, daysInMonth(year, month)), month, year };
}

/**
 * Where a grid key press moves focus, following the WAI-ARIA grid pattern.
 *
 * @param key A `KeyboardEvent.key`.
 * @param from The focused day.
 * @returns The day to focus, or null when the key does nothing.
 */
export function moveFocus(key: string, from: CalendarDate) {
  const weekday = (new Date(Date.UTC(from.year, from.month - 1, from.day)).getUTCDay() + 6) % 7;

  switch (key) {
    case "ArrowLeft": {
      return addDays(from, -1);
    }

    case "ArrowRight": {
      return addDays(from, 1);
    }

    case "ArrowUp": {
      return addDays(from, -7);
    }

    case "ArrowDown": {
      return addDays(from, 7);
    }

    case "Home": {
      return addDays(from, -weekday);
    }

    case "End": {
      return addDays(from, 6 - weekday);
    }

    case "PageUp": {
      return shiftMonth(from, -1);
    }

    case "PageDown": {
      return shiftMonth(from, 1);
    }

    default: {
      return null;
    }
  }
}
