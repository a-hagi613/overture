import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";

const matchesRowSchema = z.object({
  company: z.string(),
  id: z.string(),
  location: z.string().nullable(),
  score: z.number().nullable(),
  title: z.string(),
});

const matchesResponseSchema = z.object({
  items: z.array(matchesRowSchema),
  total: z.number(),
});

export type MatchesResponse = z.infer<typeof matchesResponseSchema>;

export type MatchRow = z.infer<typeof matchesRowSchema>;

async function loadMatches() {
  const response = await fetch("/api/matches");

  if (!response.ok) {
    throw new Error(`The matches request did not go through (${String(response.status)}).`);
  }

  return matchesResponseSchema.parse(await response.json());
}

export function useMatches() {
  return useQuery({ queryFn: loadMatches, queryKey: ["matches"], retry: 1 });
}

export function scoreLabelOf(score: number | null) {
  return score === null ? copy.home.sections.matches.scoring : copy.board.matchPercent(score);
}
