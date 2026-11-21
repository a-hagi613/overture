import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const homeResponseSchema = z.object({
  applicationsLeft: z.number(),
  planApplications: z.number(),
  sentToday: z.number(),
  dailyCap: z.number(),
  running: z.boolean().optional(),
});

export type HomeResponse = z.infer<typeof homeResponseSchema>;

async function loadHome() {
  const response = await fetch("/api/home");

  if (!response.ok) {
    throw new Error(`The home request did not go through (${String(response.status)}).`);
  }

  return homeResponseSchema.parse(await response.json());
}

export function useHomeData() {
  return useQuery({ queryKey: ["home"], queryFn: loadHome });
}

const runningSchema = z.object({ pauseReason: z.string().nullable(), running: z.boolean() });

async function saveRunning(running: boolean) {
  const response = await fetch("/api/running", {
    body: JSON.stringify({ running }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`The running request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return runningSchema.parse(body);
}

export function useRunning() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveRunning,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["home"] });
    },
  });
}
