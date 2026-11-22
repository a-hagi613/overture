import type { CalendarItem } from "./calendar-api.ts";
import type { CalendarDate, ChipKind } from "./calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { chipKindOf } from "./calendar-grid.ts";
import { timeText } from "./home-time.ts";

export const CHIP_KINDS = [
  "sent",
  "stage",
  "offer",
  "closed",
  "checkin",
  "interview",
] as const satisfies readonly ChipKind[];

export function countsOf(items: readonly CalendarItem[]) {
  const counts: Record<ChipKind, number> = {
    checkin: 0,
    closed: 0,
    interview: 0,
    offer: 0,
    sent: 0,
    stage: 0,
  };

  for (const entry of items) {
    counts[chipKindOf(entry)] += 1;
  }

  return counts;
}

function utcNoon(date: CalendarDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}

/**
 * The long form of a day, for example "Tuesday 17 November".
 *
 * @param date The local day.
 * @returns The weekday, day and month names.
 */
export function dayParts(date: CalendarDate) {
  const options = { timeZone: "UTC" } as const;
  const locale = copy.calendar.dateLocale;

  return {
    day: new Intl.DateTimeFormat(locale, { ...options, day: "numeric", month: "long" }).format(
      utcNoon(date),
    ),
    weekday: new Intl.DateTimeFormat(locale, { ...options, weekday: "long" }).format(utcNoon(date)),
  };
}

export function dayLabel(date: CalendarDate) {
  const { day, weekday } = dayParts(date);

  return `${weekday} ${day}`;
}

export function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat(copy.calendar.dateLocale, {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

export function monthName(month: number) {
  return new Intl.DateTimeFormat(copy.calendar.dateLocale, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, 1, 12)));
}

/**
 * The weekday names for the header row, Monday first.
 *
 * @param width Whether to spell the name out, abbreviate it, or use one letter.
 * @returns Seven names.
 */
export function weekdayNames(width: "long" | "short" | "narrow") {
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(copy.calendar.dateLocale, {
      timeZone: "UTC",
      weekday: width,
    }).format(new Date(Date.UTC(2026, 10, 2 + index, 12))),
  );
}

export function countText(items: readonly CalendarItem[]) {
  const counts = countsOf(items);

  return CHIP_KINDS.flatMap((kind) =>
    counts[kind] > 0 ? [copy.calendar.countLabels[kind](counts[kind])] : [],
  );
}

export function cellLabel(date: CalendarDate, items: readonly CalendarItem[]) {
  const parts = countText(items);

  return `${dayLabel(date)}, ${parts.length === 0 ? copy.calendar.nothing : parts.join(", ")}`;
}

export function summaryText(items: readonly CalendarItem[], today: boolean) {
  const parts = countText(items);

  if (parts.length === 0) {
    return today ? copy.calendar.sentToday(0) : copy.calendar.countLabels.sent(0);
  }

  const [first, ...rest] = parts;
  const counts = countsOf(items);
  const head = counts.sent > 0 && today ? copy.calendar.sentToday(counts.sent) : first;

  return [head, ...rest.filter((part) => part !== head)].join(" · ");
}

export function timeOf(at: number, zone: string) {
  return timeText(at, zone);
}

export function stageName(stage: CalendarItem["stage"]) {
  return stage === null ? "" : copy.calendar.stages[stage];
}

function capitalised(text: string) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * The line under a company in the day panel.
 *
 * @param entry A Calendar item.
 * @returns What happened, plus the job title where it helps.
 */
export function detailOf(entry: CalendarItem) {
  switch (chipKindOf(entry)) {
    case "closed": {
      const reason = entry.closedReason === null ? null : capitalised(entry.closedReason);

      return copy.calendar.closedReason(reason);
    }

    case "stage": {
      return `${copy.calendar.movedTo(stageName(entry.stage))} · ${entry.title}`;
    }

    case "checkin": {
      return `${copy.calendar.checkinDue} · ${entry.title}`;
    }

    case "offer": {
      return `${copy.calendar.kinds.offer} · ${entry.title}`;
    }

    case "interview": {
      return `${copy.calendar.kinds.interview} · ${entry.title}`;
    }

    default: {
      return entry.title;
    }
  }
}
