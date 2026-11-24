import { z } from "zod";

/**
 * The structured classification report the daily run publishes into `stapply-daily.json` and
 * `catalog/latest.json` (WS-17a/WS-17b). Every field is a plain count except the Haiku token and dollar figures, so
 * the owner can read coverage and cost without opening the runner log, and the admin catalog page can render it
 * from the same schema the producer validates against.
 */
export const taggingReportSchema = z.object({
  total_postings: z.number().int().nonnegative(),
  cross_board_dupes_removed: z.number().int().nonnegative(),
  unique_title_dept_pairs: z.number().int().nonnegative(),
  cache_hit: z.number().int().nonnegative(),
  tier1_esco_rules: z.number().int().nonnegative(),
  tier2_embeddings: z.number().int().nonnegative(),
  tier3_haiku_batch_sent: z.number().int().nonnegative(),
  tier3_haiku_resolved: z.number().int().nonnegative(),
  still_untagged: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  tier3_cost_usd: z.number().nonnegative(),
});

export type TaggingReport = z.infer<typeof taggingReportSchema>;
