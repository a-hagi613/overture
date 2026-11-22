import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { NOTIFICATION_PREFERENCE_KEYS } from "../../shared/notifications.ts";
import type {
  NotificationPreferenceKey,
  NotificationPreferences,
} from "../../shared/notifications.ts";

const preferencesSchema = z.object({
  preferences: z.record(z.enum(NOTIFICATION_PREFERENCE_KEYS), z.boolean()),
});

export const NOTIFICATION_PREFERENCES_QUERY_KEY = ["notification-preferences"] as const;

async function responseJson(response: Response) {
  if (!response.ok) {
    throw new Error(`The request failed with ${String(response.status)}.`);
  }

  const body: unknown = await response.json();

  return body;
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: async () => {
      const body = preferencesSchema.parse(
        await responseJson(await fetch("/api/notifications/preferences")),
      );

      return body.preferences;
    },
  });
}

/**
 * Saves one switch. The new value shows at once and rolls back when the save
 * fails, so a switch never shows a kind as off while the server still sends it.
 *
 * @returns The mutation; its result is the saved preferences.
 */
export function useSetNotificationPreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { enabled: boolean; kind: NotificationPreferenceKey }) => {
      const body = preferencesSchema.parse(
        await responseJson(
          await fetch("/api/notifications/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
        ),
      );

      return body.preferences;
    },
    onMutate: async ({ enabled, kind }) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY });

      const previous = queryClient.getQueryData<NotificationPreferences>(
        NOTIFICATION_PREFERENCES_QUERY_KEY,
      );

      if (previous !== undefined) {
        queryClient.setQueryData<NotificationPreferences>(NOTIFICATION_PREFERENCES_QUERY_KEY, {
          ...previous,
          [kind]: enabled,
        });
      }

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, context.previous);
      }
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, saved);
    },
  });
}
