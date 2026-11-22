import type { AppDatabase } from "./db/client.ts";
import type { Clock } from "./ports/clock.ts";

import { unhandledRejectionDetail } from "./alert-detail.ts";
import { raiseAlert } from "./alerts.ts";
import { logError } from "./log.ts";

const ALERT_COOLDOWN_MS = 60_000;

let unhandledRejections = 0;
let lastAlertAt: number | null = null;

export function unhandledRejectionCount() {
  return unhandledRejections;
}

export function installProcessGuards(db: AppDatabase, clock: Clock) {
  process.on("unhandledRejection", (reason) => {
    unhandledRejections += 1;
    logError("unhandledRejection", reason);

    const now = clock.now();

    if (lastAlertAt !== null && now - lastAlertAt < ALERT_COOLDOWN_MS) {
      return;
    }

    lastAlertAt = now;

    try {
      const errorName = reason instanceof Error ? reason.name : "NonError";

      raiseAlert(
        db,
        clock,
        "process.unhandled",
        unhandledRejectionDetail(errorName, unhandledRejections),
      );
    } catch (error) {
      logError("processGuard.alert", error);
    }
  });
}
