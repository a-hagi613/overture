export interface ScoreLimiter {
  allow: (key: string) => boolean;
}

export interface ScoreLimiterOptions {
  limit: number;
  windowMs: number;
  now: () => number;
}

interface Window {
  count: number;
  startedAt: number;
}

export function createScoreLimiter(options: ScoreLimiterOptions) {
  const windows = new Map<string, Window>();

  return {
    allow: (key: string) => {
      const at = options.now();
      const current = windows.get(key);

      if (current === undefined || at - current.startedAt >= options.windowMs) {
        windows.set(key, { count: 1, startedAt: at });

        return true;
      }

      if (current.count >= options.limit) {
        return false;
      }

      current.count += 1;

      return true;
    },
  } satisfies ScoreLimiter;
}
