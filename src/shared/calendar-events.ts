import { z } from "zod";

/** The three things a person adds to their own Calendar (H6). */
export const CALENDAR_CUSTOM_EVENT_KINDS = ["interview", "followup", "reminder"] as const;

export type CalendarCustomEventKind = (typeof CALENDAR_CUSTOM_EVENT_KINDS)[number];

export const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export const TIME_PATTERN = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u;

function isRealDayKey(value: string) {
  if (!DAY_KEY_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * A day key the Calendar grid can place: `YYYY-MM-DD` and a real calendar day,
 * so `2026-02-31` is refused instead of silently rolling into March.
 */
export const dayKeySchema = z
  .string()
  .refine(isRealDayKey, { message: "dayKey must be a real day in YYYY-MM-DD form" });

export const calendarEventInputSchema = z.object({
  company: z.string().trim().max(200).optional().default(""),
  dayKey: dayKeySchema,
  kind: z.enum(CALENDAR_CUSTOM_EVENT_KINDS),
  time: z.string().regex(TIME_PATTERN).nullable().optional().default(null),
  title: z.string().trim().min(1).max(200),
});

export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

export const calendarEventsQuerySchema = z
  .object({
    from: dayKeySchema.optional(),
    to: dayKeySchema.optional(),
  })
  .refine((value) => (value.from === undefined) === (value.to === undefined), {
    message: "from and to arrive together",
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: "from must not be after to",
  });

export type CalendarEventsQuery = z.infer<typeof calendarEventsQuerySchema>;
