import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const notificationSchema = z.object({
  at: z.number(),
  body: z.string(),
  id: z.string(),
  kind: z.string(),
  pushedAt: z.number().nullable(),
  readAt: z.number().nullable(),
  title: z.string(),
  url: z.string(),
});

const notificationsSchema = z.object({
  notifications: z.array(notificationSchema),
  now: z.number(),
  unread: z.number(),
});

export type NotificationRow = z.infer<typeof notificationSchema>;

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

async function responseJson(response: Response) {
  if (!response.ok) {
    throw new Error(`The request failed with ${String(response.status)}.`);
  }

  const body: unknown = await response.json();

  return body;
}

export function useNotifications() {
  return useQuery({
    queryFn: async () =>
      notificationsSchema.parse(await responseJson(await fetch("/api/notifications"))),
    queryKey: NOTIFICATIONS_QUERY_KEY,
  });
}

export function useUnreadNotificationCount() {
  const { data } = useNotifications();

  return data?.unread ?? 0;
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await responseJson(await fetch("/api/notifications/read-all", { method: "POST" }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await responseJson(
        await fetch("/api/notifications/read", {
          body: JSON.stringify({ id }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}
