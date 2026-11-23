import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { CALENDAR_CUSTOM_EVENT_KINDS } from "../../shared/calendar-events.ts";

const customEventSchema = z.object({
  company: z.string(),
  dayKey: z.string(),
  id: z.string(),
  kind: z.enum(CALENDAR_CUSTOM_EVENT_KINDS),
  time: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
  title: z.string(),
});

const listResponseSchema = z.object({
  events: z.array(customEventSchema),
});

const createResponseSchema = z.object({
  event: customEventSchema,
});

export type CustomCalendarEvent = z.infer<typeof customEventSchema>;

export type CustomCalendarEventKind = CustomCalendarEvent["kind"];

export interface CreateCustomCalendarEventInput {
  company: string;
  dayKey: string;
  kind: CustomCalendarEventKind;
  time: string;
  title: string;
}

export const CALENDAR_CUSTOM_EVENTS_KEY = ["calendar", "custom-events"] as const;

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The calendar event request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
}

export async function fetchCustomCalendarEvents() {
  const body = listResponseSchema.parse(await jsonFrom(await fetch("/api/calendar/events")));

  return body.events;
}

export async function createCustomCalendarEvent(input: CreateCustomCalendarEventInput) {
  const trimmedTime = input.time.trim();

  const body = createResponseSchema.parse(
    await jsonFrom(
      await fetch("/api/calendar/events", {
        body: JSON.stringify({
          company: input.company.trim(),
          dayKey: input.dayKey,
          kind: input.kind,
          time: trimmedTime === "" ? null : trimmedTime,
          title: input.title.trim(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );

  return body.event;
}

export async function deleteCustomCalendarEvent(id: string) {
  await jsonFrom(
    await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}

export function useCalendarCustomEvents() {
  return useQuery({
    queryFn: fetchCustomCalendarEvents,
    queryKey: CALENDAR_CUSTOM_EVENTS_KEY,
  });
}

export function useCreateCalendarCustomEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCustomCalendarEvent,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
  });
}

export function useDeleteCalendarCustomEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCustomCalendarEvent,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
  });
}
