import { createContext } from "react";

import type { CalendarItem } from "./calendar-api.ts";
import type { CustomCalendarEvent } from "./calendar-custom-events.ts";
import type { CalendarDate } from "./calendar-grid.ts";

export interface CalendarDayContextValue {
  buckets: ReadonlyMap<string, readonly CalendarItem[]>;
  customByDay: ReadonlyMap<string, readonly CustomCalendarEvent[]>;
  onSelectDate: (date: CalendarDate) => void;
  selectedKey: string;
  todayKey: string;
}

const ignoreDaySelect = () => undefined;

const fallbackCalendarDayContext: CalendarDayContextValue = {
  buckets: new Map(),
  customByDay: new Map(),
  onSelectDate: ignoreDaySelect,
  selectedKey: "",
  todayKey: "",
};

export const CalendarDayContext = createContext<CalendarDayContextValue>(
  fallbackCalendarDayContext,
);

export function toCalendarDate(date: Date) {
  return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
}
