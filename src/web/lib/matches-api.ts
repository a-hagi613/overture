import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";

const matchBandSchema = z.enum(["strong", "good", "possible"]);

const matchesRowSchema = z.object({
  applicationId: z.string().nullable(),
  band: matchBandSchema.nullable(),
  company: z.string(),
  id: z.string(),
  location: z.string().nullable(),
  postedAt: z.number().nullable(),
  reasons: z.array(z.string()),
  score: z.number().nullable(),
  title: z.string(),
});

const matchesResponseSchema = z.object({
  items: z.array(matchesRowSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

const appliedSchema = z.object({
  applicationId: z.string(),
  created: z.boolean(),
});

export type MatchesResponse = z.infer<typeof matchesResponseSchema>;

export type MatchRow = z.infer<typeof matchesRowSchema>;

export type MatchBand = z.infer<typeof matchBandSchema>;

async function loadMatches(page: number) {
  const response = await fetch(`/api/matches?page=${String(page)}`);

  if (!response.ok) {
    throw new Error(`The matches request did not go through (${String(response.status)}).`);
  }

  return matchesResponseSchema.parse(await response.json());
}

export function useMatches(page: number) {
  return useQuery({
    queryFn: async () => loadMatches(page),
    queryKey: ["matches", page],
    retry: 1,
  });
}

async function applyToPosting(postingId: string) {
  const response = await fetch(`/api/postings/${encodeURIComponent(postingId)}/apply`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`The apply request did not go through (${String(response.status)}).`);
  }

  return appliedSchema.parse(await response.json());
}

/**
 * Starts an application from a Matches row, then opens it on the Tracker. The server decides
 * whether the job is safe to apply to; a refused job leaves the row in place.
 *
 * @returns The mutation that starts the application.
 */
export function useApplyToPosting() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: applyToPosting,
    onSuccess: (applied) => {
      void queryClient.invalidateQueries({ queryKey: ["matches"] });
      void navigate(`/tracker?application=${encodeURIComponent(applied.applicationId)}`);
    },
  });
}

export function scoreLabelOf(score: number | null) {
  return score === null ? copy.matches.scoring : copy.board.matchPercent(score);
}

export function bandLabelOf(band: MatchBand | null) {
  return band === null ? null : copy.matches.band[band];
}
