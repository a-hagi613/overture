import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const supportAccessSchema = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      at: z.number(),
      detail: z.record(z.string(), z.unknown()),
      id: z.string(),
      reason: z.string(),
    }),
  ),
});

export type SupportAccessEntry = z.infer<typeof supportAccessSchema>["entries"][number];

export const SUPPORT_ACCESS_QUERY_KEY = ["support-access"] as const;

export function useSupportAccess() {
  return useQuery({
    queryKey: SUPPORT_ACCESS_QUERY_KEY,
    queryFn: async () => {
      const response = await fetch("/api/support-access");

      if (!response.ok) {
        throw new Error(`The request failed with ${String(response.status)}.`);
      }

      const body: unknown = await response.json();

      return supportAccessSchema.parse(body).entries;
    },
  });
}
