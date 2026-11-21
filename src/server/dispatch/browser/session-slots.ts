import type { AppDatabase } from "../../platform/db/client.ts";

import { getSetting } from "../../platform/settings/index.ts";

export const DEFAULT_MAX_CONCURRENT_SESSIONS = 3;
export const MAX_CONCURRENT_SESSIONS_SETTING = "browser.max_concurrent_sessions";

const MIN_CONCURRENT_SESSIONS = 1;

interface Waiter {
  resolve: () => void;
}

const waiting: Waiter[] = [];

let active = 0;
let limitSource = () => DEFAULT_MAX_CONCURRENT_SESSIONS;

export function maxConcurrentSessionsFromSetting(db: AppDatabase) {
  const raw = getSetting(db, MAX_CONCURRENT_SESSIONS_SETTING);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= MIN_CONCURRENT_SESSIONS
    ? Math.trunc(parsed)
    : DEFAULT_MAX_CONCURRENT_SESSIONS;
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
