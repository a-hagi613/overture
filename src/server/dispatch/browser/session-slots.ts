import type { AppDatabase } from "../../platform/db/client.ts";

import { getSettingNumber } from "../../platform/settings/index.ts";

export const DEFAULT_MAX_CONCURRENT_SESSIONS = 3;
export const MAX_CONCURRENT_SESSIONS_SETTING = "browser.max_concurrent_sessions";

const MIN_CONCURRENT_SESSIONS = 1;

interface Waiter {
  resolve: () => void;
}

const waiting: Waiter[] = [];

let active = 0;
let limitSource = () => DEFAULT_MAX_CONCURRENT_SESSIONS;

export interface BrowserSessionAvailability {
  /** How many sessions the one browser setting allows. */
  limit: number;
  /** How many sessions hold a slot right now, whether a send, a capture or a probe. */
  active: number;
  /** How many sessions a new caller could take at once. */
  available: number;
  /** How many callers wait for a slot. */
  waiting: number;
}

/**
 * The live session semaphore, so the dispatcher sizes its send cap from the same
 * number every browser user holds a slot from. A capture, probe or lab run holding a
 * slot therefore takes it away from a send instead of the dispatcher counting it free.
 * @returns The limit, the holders, the free sessions and the waiters.
 */
export function browserSessionAvailability() {
  const limit = limitSource();

  return {
    active,
    available: Math.max(0, limit - active),
    limit,
    waiting: waiting.length,
  } satisfies BrowserSessionAvailability;
}

/**
 * The smaller of the dispatcher's send cap and the sessions actually free right now.
 * @param activeSends Applications with send work already in flight.
 * @param availability The live semaphore state.
 * @returns How many sends may be claimed this tick.
 */
export function freeSendSlots(activeSends: number, availability: BrowserSessionAvailability) {
  return Math.max(0, Math.min(availability.limit - activeSends, availability.available));
}

export function maxConcurrentSessionsFromSetting(db: AppDatabase) {
  return getSettingNumber(db, MAX_CONCURRENT_SESSIONS_SETTING, {
    fallback: DEFAULT_MAX_CONCURRENT_SESSIONS,
    integer: true,
    minimum: MIN_CONCURRENT_SESSIONS,
  });
}

export function configureBrowserSessionLimitFromSetting(db: AppDatabase) {
  limitSource = () => maxConcurrentSessionsFromSetting(db);
}

function createRelease() {
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    active -= 1;
    grantWaiting();
  };
}

function grantWaiting() {
  while (waiting.length > 0 && active < limitSource()) {
    const waiter = waiting.shift();

    if (waiter === undefined) {
      return;
    }

    active += 1;
    waiter.resolve();
  }
}

async function waitForSlot(signal: AbortSignal | undefined) {
  return new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = { resolve: () => undefined };

    const detach = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      detach();

      const index = waiting.indexOf(waiter);

      if (index !== -1) {
        waiting.splice(index, 1);
      }

      reject(new Error("the browser session slot wait was interrupted"));
    };

    waiter.resolve = () => {
      detach();
      resolve(createRelease());
    };

    waiting.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function acquireBrowserSession(signal?: AbortSignal) {
  if (signal?.aborted === true) {
    throw new Error("the browser session slot wait was interrupted");
  }

  if (active < limitSource()) {
    active += 1;

    return createRelease();
  }

  return waitForSlot(signal);
}
