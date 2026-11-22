const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_THRESHOLD_MS = 2000;
const DEFAULT_COOLDOWN_MS = 60_000;

export interface EventLoopLagMonitorOptions {
  /** Called once per stall with how long the loop was blocked, in milliseconds. */
  onLag: (lagMs: number) => void;
  /** The timer interval, which is also the amount of drift that counts as normal. */
  intervalMs?: number;
  /** Drift above this is reported as a stall. */
  thresholdMs?: number;
  /** Minimum gap between two reports, so one long stall does not spam the log. */
  cooldownMs?: number;
  /** Monotonic time source; defaults to `performance.now`. */
  now?: () => number;
}

export interface EventLoopLagMonitor {
  /**
   * Records one timer tick.
   * @param at When the tick actually ran, from the monitor's time source.
   * @returns The drift in milliseconds; negative values mean the tick ran early.
   */
  sample: (at: number) => number;
  /** Starts the interval timer and returns a function that stops it. */
  start: () => () => void;
}

/**
 * Watches how far the event loop drifts from its timer schedule.
 *
 * A blocked main thread is invisible in the application log: HTTP requests queue
 * up, timers fire late, and nothing is written until the block ends. Measuring the
 * drift on a timer makes that block visible (`event-loop-lag`) and turns "the
 * machine answered no health check for five minutes" into a log line with a
 * duration, which is the evidence the Fly health-check incident did not have.
 * @param options The reporter and the timing knobs.
 * @returns A monitor whose `start` installs the interval timer.
 */
export function createEventLoopLagMonitor(options: EventLoopLagMonitorOptions) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? (() => performance.now());

  let expectedAt = now();
  let lastReportAt: number | null = null;

  function sample(at: number) {
    const lagMs = at - expectedAt - intervalMs;

    expectedAt = at;

    if (lagMs < thresholdMs) {
      return lagMs;
    }

    if (lastReportAt !== null && at - lastReportAt < cooldownMs) {
      return lagMs;
    }

    lastReportAt = at;
    options.onLag(lagMs);

    return lagMs;
  }

  function start() {
    const timer = setInterval(() => {
      sample(now());
    }, intervalMs);

    timer.unref();

    return () => {
      clearInterval(timer);
    };
  }

  return { sample, start };
}
