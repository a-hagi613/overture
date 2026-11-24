import { defaultMetrics } from "./metrics.ts";

export interface EventLoopLagStats {
  /** Records one timer-drift sample in milliseconds. */
  sample: (lagMs: number) => void;
  /** The p95 of the retained window, or null before the first sample. */
  p95: () => number | null;
  /** Number of retained samples. */
  size: () => number;
}

const DEFAULT_CAPACITY = 512;

/**
 * A small rolling window of event-loop drift samples. The existing monitor only logs a stall past
 * its threshold; the ops endpoint needs a p95 even when nothing stalled, and the histogram needs
 * every sample. Values are clamped at zero because a timer that fires early is not a stall.
 * @param options The window size and an injectable sink (tests).
 * @returns A sampler that feeds both the histogram and the p95.
 */
export function createEventLoopLagStats(
  options: { capacity?: number; onSample?: (lagMs: number) => void } = {},
) {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);

  const onSample =
    options.onSample ?? ((lagMs: number) => defaultMetrics().recordEventLoopLag(lagMs));

  const samples: number[] = [];

  const stats = {
    p95: () => {
      if (samples.length === 0) {
        return null;
      }

      const sorted = samples.toSorted((left, right) => left - right);
      const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

      return sorted[index] ?? null;
    },
    sample: (lagMs) => {
      const value = Math.max(0, lagMs);

      samples.push(value);

      if (samples.length > capacity) {
        samples.splice(0, samples.length - capacity);
      }

      onSample(value);
    },
    size: () => samples.length,
  } satisfies EventLoopLagStats;

  return stats;
}
