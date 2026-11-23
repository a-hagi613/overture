export interface ScoreLimiter {
  allow: (key: string) => boolean;
  /** How many client buckets are held right now, which never exceeds `maxKeys`. */
  size: () => number;
}

export interface ScoreLimiterOptions {
  limit: number;
  windowMs: number;
  now: () => number;
  /** The most client buckets kept before the oldest are evicted; defaults to 10 000. */
  maxKeys?: number;
}

interface Window {
  count: number;
  startedAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

/**
 * A per-client fixed-window limiter for the lab's score endpoint. Buckets expire with their window and the map is
 * bounded, so a stream of forged client keys cannot grow memory without limit.
 * @param options The window, the maximum and the clock.
 * @returns The limiter, whose `allow` counts one request for a client.
 */
export function createScoreLimiter(options: ScoreLimiterOptions) {
  const windows = new Map<string, Window>();
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

  function evict(at: number) {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= options.windowMs) {
        windows.delete(key);
      }
    }

    for (const key of windows.keys()) {
      if (windows.size < maxKeys) {
        return;
      }

      windows.delete(key);
    }
  }

  return {
    allow: (key: string) => {
      const at = options.now();
      const current = windows.get(key);

      if (current === undefined) {
        if (windows.size >= maxKeys) {
          evict(at);
        }

        windows.set(key, { count: 1, startedAt: at });

        return true;
      }

      if (at - current.startedAt >= options.windowMs) {
        windows.set(key, { count: 1, startedAt: at });

        return true;
      }

      if (current.count >= options.limit) {
        return false;
      }

      current.count += 1;

      return true;
    },
    size: () => windows.size,
  } satisfies ScoreLimiter;
}
