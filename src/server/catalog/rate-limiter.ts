import { createClock } from "../platform/ports/clock.ts";

import type { Clock } from "../platform/ports/clock.ts";

export interface RateLimiterOptions {
  maxConcurrent: number;
  minIntervalMs: number;
}

export interface RateLimiter {
  run: <T>(task: () => Promise<T>) => Promise<T>;
  inFlight: () => number;
}

export function createRateLimiter(clock: Clock, options: RateLimiterOptions) {
  const { maxConcurrent, minIntervalMs } = options;
  const waiting: (() => void)[] = [];
  let inFlightCount = 0;
  let nextStartAt = clock.now();

  const release = () => {
    inFlightCount -= 1;

    const resume = waiting.shift();

    if (resume !== undefined) {
      resume();
    }
  };

  const acquire = async () => {
    if (inFlightCount < maxConcurrent) {
      inFlightCount += 1;

      return;
    }

    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });

    return acquire();
  };

  const run = async <T>(task: () => Promise<T>) => {
    const nowStart = clock.now();
    const earliest = Math.max(nextStartAt, nowStart);

    nextStartAt = earliest + minIntervalMs;

    const waitMs = earliest - nowStart;

    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }

    await acquire();

    try {
      return await task();
    } finally {
      release();
    }
  };

  return {
    run,
    inFlight: () => inFlightCount,
  } satisfies RateLimiter;
}

const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

const SYSTEM_CLOCK: Clock = createClock();

export const GREENHOUSE_LIMITS: RateLimiterOptions = { maxConcurrent: 4, minIntervalMs: 500 };

export function limiterFor(ats: string, options: RateLimiterOptions) {
  const existing = limiters.get(ats);

  if (existing !== undefined) {
    return existing;
  }

  const limiter = createRateLimiter(SYSTEM_CLOCK, options);

  limiters.set(ats, limiter);

  return limiter;
}
