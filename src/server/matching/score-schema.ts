import { z } from "zod";

export const SCORE_BLOCKERS = [
  "license_required",
  "language_required",
  "level_far_off",
  "wrong_field",
  "location_incompatible",
  "not_a_job",
] as const;

export type ScoreBlocker = (typeof SCORE_BLOCKERS)[number];

/** The four anchored sub-scores. The sum is the stored match score, computed in code and never by the model. */
export const scoreReplySchema = z.object({
  blockers: z.array(z.enum(SCORE_BLOCKERS)),
  level: z.union([z.literal(0), z.literal(4), z.literal(12), z.literal(20)]),
  logistics: z.union([z.literal(0), z.literal(5), z.literal(10)]),
  reasons: z.array(z.string().trim().min(1).max(110)).min(2).max(3),
  role_fit: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(40)]),
  skills: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(30)]),
});

export type ScoreReply = z.infer<typeof scoreReplySchema>;

/**
 * Validates one model reply before anything is stored. A null, non-JSON, malformed or free-text reply is a rejection,
 * never a partial score.
 * @param text The reply's text block.
 * @returns The parsed score, or null when the reply does not match the schema.
 */
export function parseScoreReply(text: string | null) {
  if (text === null) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = scoreReplySchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * Adds the four sub-scores. The model never returns an overall number, so this is the only place a score is computed.
 * @param reply A validated reply.
 * @returns The 0–100 score.
 */
export function scoreOf(reply: Pick<ScoreReply, "role_fit" | "skills" | "level" | "logistics">) {
  return reply.role_fit + reply.skills + reply.level + reply.logistics;
}
