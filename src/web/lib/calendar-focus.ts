import type { CalendarDate } from "./calendar-grid.ts";

import { dateIn } from "./calendar-grid.ts";

export function initialFocus({
  asked,
  now,
  zone,
}: {
  asked: { month: number; year: number } | null;
  now: number;
  zone: string;
}) {
  const today = dateIn(now, zone);

  return asked !== null && (asked.year !== today.year || asked.month !== today.month)
    ? { day: 1, ...asked }
    : today;
}

export function anchorFocus({
  focus,
  localZone,
  navigated,
  now,
  savedZone,
}: {
  focus: CalendarDate;
  localZone: string;
  navigated: boolean;
  now: number;
  savedZone: string;
}) {
  if (navigated || savedZone === localZone) {
    return focus;
  }

  const localToday = dateIn(now, localZone);

  if (focus.year !== localToday.year || focus.month !== localToday.month) {
    return focus;
  }

  return dateIn(now, savedZone);
}
