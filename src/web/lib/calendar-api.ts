import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const CALENDAR_KINDS = ["sent", "stage", "checkin", "interview"] as const;

export const CALENDAR_STAGES = ["applied", "screening", "interviewing", "offer", "closed"] as const;

const calendarItemSchema = z.object({
  applicationId: z.string(),
  at: z.number(),
  closedReason: z.string().nullable(),
  company: z.string(),
  id: z.string(),
  kind: z.enum(CALENDAR_KINDS),
  source: z.enum(["system", "user", "email", "checkin", "admin"]).nullable(),
  stage: z.enum(CALENDAR_STAGES).nullable(),
  title: z.string(),
});

const calendarResponseSchema = z.object({
  items: z.array(calendarItemSchema),
  timeZone: z.string(),
});

export type CalendarItem = z.infer<typeof calendarItemSchema>;

export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export type CalendarKind = CalendarItem["kind"];

export interface CalendarRange {
  from: number;
  to: number;
}

async function loadCalendar(range: CalendarRange, gridZone: string) {
  const query = new URLSearchParams({
    from: new Date(range.from).toISOString(),
    timezone: gridZone,
    to: new Date(range.to).toISOString(),
  });

  const response = await fetch(`/api/calendar?${query.toString()}`);

  if (!response.ok) {
    throw new Error(`The Calendar request did not go through (${String(response.status)}).`);
  }

  return calendarResponseSchema.parse(await response.json());
}

/**
 * The Calendar for a window the browser draws in `gridZone`. The server counts the window's days in that zone
 * and buckets the items in the user's saved zone, which the response carries.
 * @param range The window to load, in milliseconds since the epoch.
 * @param gridZone The IANA time zone the browser draws the grid in.
 * @returns The query for the window's items and the user's time zone.
 */
export function useCalendar(range: CalendarRange, gridZone: string) {
  return useQuery({
    queryFn: async () => loadCalendar(range, gridZone),
    placeholderData: keepPreviousData,
    queryKey: ["calendar", range.from, range.to, gridZone],
  });
}
