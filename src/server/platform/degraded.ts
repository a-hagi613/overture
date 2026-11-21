import type { Clock } from "./ports/clock.ts";
import type { ObjectStore } from "./ports/object-store.ts";

import {
  DEGRADED_FLAG_KEY,
  describeDegradedMetrics,
  parseDegradedFlag,
} from "../../shared/degraded.ts";
import { logState } from "./log.ts";

import type { DegradedFlag } from "../../shared/degraded.ts";

export interface DegradedFlagReader {
  /** The current flag, or null when Cloudflare usage is inside its allowances. */
  read: () => Promise<DegradedFlag | null>;
  isDegraded: () => Promise<boolean>;
}

const REFRESH_MS = 60_000;

/**
 * Reads the flag the sentinel Worker writes (ADR 0033, #283) through the same object store the
 * app already uses, caches it for a minute so a burst of mail costs one R2 read, and logs every
 * change of state so a behaviour change is visible in the app's log.
 */
export function createDegradedFlag(deps: {
  clock: Clock;
  objects: ObjectStore;
  refreshMs?: number;
}): DegradedFlagReader {
  const refreshMs = deps.refreshMs ?? REFRESH_MS;
  let checkedAt: number | null = null;
  let current: DegradedFlag | null = null;

  async function read() {
    const now = deps.clock.now();

    if (checkedAt !== null && now - checkedAt < refreshMs) {
      return current;
    }

    let flag: DegradedFlag | null = null;

    try {
      const raw = await deps.objects.get(DEGRADED_FLAG_KEY);

      flag = raw === null ? null : parseDegradedFlag(new TextDecoder().decode(raw));

      if (raw !== null && flag === null) {
        logState("degraded", "flag is present but unreadable; leaving behaviour unchanged");
      }
    } catch (error) {
      logState(
        "degraded",
        `flag read failed, keeping ${current === null ? "normal" : "degraded"} behaviour: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      checkedAt = now;

      return current;
    }

    if (current === null && flag !== null) {
      logState(
        "degraded",
        `enabled since ${flag.since}; ${describeDegradedMetrics(flag.metrics)}; non-essential R2 writes stop and email_classify runs rules-only`,
      );
    }

    if (current !== null && flag === null) {
      logState("degraded", "cleared; normal R2 writes and email_classify resume");
    }

    checkedAt = now;
    current = flag;

    return current;
  }

  return {
    read,
    isDegraded: async () => (await read()) !== null,
  };
}
