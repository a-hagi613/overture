import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const statusSchema = z.object({
  createdAt: z.number().nullable(),
  enabled: z.boolean(),
  rotatedAt: z.number().nullable(),
});

const issuedSchema = z.object({
  path: z.string().regex(/^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/u),
  status: statusSchema,
});

export type CalendarFeedStatus = z.infer<typeof statusSchema>;

export const CALENDAR_FEED_QUERY_KEY = ["calendar-feed"] as const;

async function responseJson(response: Response) {
  if (!response.ok) {
    throw new Error(`The request failed with ${String(response.status)}.`);
  }

  const body: unknown = await response.json();

  return body;
}

export function useCalendarFeed() {
  return useQuery({
    queryKey: CALENDAR_FEED_QUERY_KEY,
    queryFn: async () => statusSchema.parse(await responseJson(await fetch("/api/calendar/feed"))),
  });
}

/**
 * Turns the feed on, or rotates it. The returned path holds the only copy of the token: the caller keeps it in
 * memory and never writes it to the query cache, and the server never returns it again.
 *
 * @returns The mutation; its result is the new `/calendar/<token>.ics` path and the updated status.
 */
export function useIssueCalendarFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const body = issuedSchema.parse(
        await responseJson(await fetch("/api/calendar/feed/token", { method: "POST" })),
      );

      return body;
    },
    onSuccess: (body) => {
      queryClient.setQueryData<CalendarFeedStatus>(CALENDAR_FEED_QUERY_KEY, body.status);
    },
  });
}

export function useRevokeCalendarFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () =>
      statusSchema.parse(
        await responseJson(await fetch("/api/calendar/feed", { method: "DELETE" })),
      ),
    onSuccess: (status) => {
      queryClient.setQueryData<CalendarFeedStatus>(CALENDAR_FEED_QUERY_KEY, status);
    },
  });
}
