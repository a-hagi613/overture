import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const homeResponseSchema = z.object({
  applicationsLeft: z.number(),
  planApplications: z.number(),
  sentToday: z.number(),
  dailyCap: z.number(),
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
