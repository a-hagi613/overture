import { z } from "zod";

const STORAGE_KEY = "overture.calendar.custom-events.v1";

const customEventSchema = z.object({
  company: z.string(),
  dayKey: z.string(),
  id: z.string(),
  kind: z.enum(["interview", "followup", "reminder"]),
  time: z.string(),
  title: z.string(),
});

const customEventListSchema = z.array(customEventSchema);

export type CustomCalendarEvent = z.infer<typeof customEventSchema>;

export type CustomCalendarEventKind = CustomCalendarEvent["kind"];

export function loadCustomCalendarEvents() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return [] satisfies CustomCalendarEvent[];
    }

    const parsed = customEventListSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : ([] satisfies CustomCalendarEvent[]);
  } catch {
    return [] satisfies CustomCalendarEvent[];
  }
}

export function saveCustomCalendarEvents(events: readonly CustomCalendarEvent[]) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));

    return true;
  } catch {
    return false;
  }
}
