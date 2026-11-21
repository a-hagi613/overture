import { z } from "zod";

/**
 * The "degraded" flag the sentinel Worker writes to R2 when a Cloudflare allowance nears its
 * limit (ADR 0033, #283). The app reads the same object through its object store, so the key and
 * the shape live here for both sides.
 */
export const DEGRADED_FLAG_KEY = "ops/degraded.json";

export const DEGRADED_THRESHOLD = 0.9;
export const WARN_THRESHOLD = 0.7;

export const degradedMetricSchema = z.object({
  metric: z.string().min(1),
  used: z.number().nonnegative(),
  allowance: z.number().positive(),
  share: z.number().nonnegative(),
});

export type DegradedMetric = z.infer<typeof degradedMetricSchema>;

export const degradedFlagSchema = z.object({
  version: z.literal(1),
  degraded: z.literal(true),
  since: z.string().min(1),
  metrics: z.array(degradedMetricSchema).min(1),
});

export type DegradedFlag = z.infer<typeof degradedFlagSchema>;

export function parseDegradedFlag(raw: string): DegradedFlag | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = degradedFlagSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

export function describeDegradedMetrics(metrics: readonly DegradedMetric[]) {
  return metrics
    .map((metric) => `${metric.metric} at ${String(Math.round(metric.share * 100))}%`)
    .join(", ");
}
