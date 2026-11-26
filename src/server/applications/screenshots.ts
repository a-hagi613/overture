import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";
import { logError } from "../platform/log.ts";

export const SCREENSHOT_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const SCREENSHOT_CLEANUP_JOB_KIND = "application.screenshots.cleanup";

export const SCREENSHOT_PREFIX = "screenshots/";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;

export type ScreenshotPhase = "before_submit" | "after_submit";

export interface ScreenshotPage {
  screenshot: (options: { fullPage: boolean; type: "png" }) => Promise<Uint8Array>;
}

export interface StoredScreenshot {
  key: string;
  at: number;
  attemptId: string;
  phase: ScreenshotPhase;
  userId: string;
  applicationId: string;
  bytes: number | null;
}

const keyPattern =
  /^screenshots\/(?<userId>[^/]+)\/(?<applicationId>[^/]+)\/(?<attemptId>[^/]+)-(?<phase>before_submit|after_submit)-(?<at>\d+)\.png$/u;

const PHASES = ["before_submit", "after_submit"] as const;

function isScreenshotPhase(value: string): value is ScreenshotPhase {
  return PHASES.some((phase) => phase === value);
}

export function applicationScreenshotPrefix(userId: string, applicationId: string) {
  return `${SCREENSHOT_PREFIX}${userId}/${applicationId}/`;
}

export function applicationScreenshotKey(input: {
  userId: string;
  applicationId: string;
  attemptId: string;
  phase: ScreenshotPhase;
  at: number;
}) {
  return `${applicationScreenshotPrefix(input.userId, input.applicationId)}${input.attemptId}-${input.phase}-${String(input.at)}.png`;
}

export function parseApplicationScreenshotKey(key: string, bytes: number | null = null) {
  const matched = keyPattern.exec(key);
  const groups = matched?.groups;

  if (groups === undefined) {
    return null;
  }

  const { applicationId, at, attemptId, phase, userId } = groups;

  if (
    userId === undefined ||
    applicationId === undefined ||
    attemptId === undefined ||
    phase === undefined ||
    at === undefined ||
    !isScreenshotPhase(phase)
  ) {
    return null;
  }

  return {
    applicationId,
    at: Number(at),
    attemptId,
    bytes,
    key,
    phase,
    userId,
  };
}

/**
 * Captures one Submit screenshot into the user's own account prefix. A broken
 * screenshot never fails the send: the error is logged and the send continues.
 * @param deps The clock that stamps the shot and the object store that keeps it.
 * @param input The application, attempt, page and Submit phase to capture.
 * @returns The stored screenshot, or null when the capture or the store failed.
 */
export async function captureSubmitScreenshot(
  deps: { clock: Clock; objects: ObjectStore },
  input: {
    applicationId: string;
    attemptId: string;
    page: ScreenshotPage;
    phase: ScreenshotPhase;
    userId: string;
  },
) {
  let bytes: Uint8Array<ArrayBuffer>;

  try {
    const image = await input.page.screenshot({ fullPage: true, type: "png" });
    bytes = new Uint8Array(image.byteLength);
    bytes.set(image);
  } catch (error) {
    logError("screenshots.capture", error);

    return null;
  }

  const at = deps.clock.now();

  const key = applicationScreenshotKey({
    applicationId: input.applicationId,
    at,
    attemptId: input.attemptId,
    phase: input.phase,
    userId: input.userId,
  });

  try {
    await deps.objects.put(key, bytes);
  } catch (error) {
    logError("screenshots.store", error);

    return null;
  }

  return {
    applicationId: input.applicationId,
    at,
    attemptId: input.attemptId,
    bytes: bytes.byteLength,
    key,
    phase: input.phase,
    userId: input.userId,
  };
}

export async function listApplicationScreenshots(
  objects: ObjectStore,
  userId: string,
  applicationId: string,
) {
  const found: StoredScreenshot[] = [];

  try {
    for await (const entry of objects.listWithSizes(
      applicationScreenshotPrefix(userId, applicationId),
    )) {
      const parsed = parseApplicationScreenshotKey(entry.key, entry.bytes);

      if (parsed !== null) {
        found.push(parsed);
      }
    }
  } catch (error) {
    logError("screenshots.list", error);

    return [];
  }

  return found.toSorted((left, right) => left.at - right.at);
}

/**
 * Deletes Submit screenshots older than the retention window. Keys that do not
 * match the screenshot format are left alone, so a foreign object is never
 * removed by the cleanup.
 * @param objects The object store holding the screenshots.
 * @param now The instant the retention cutoff is measured from.
 * @param retentionMs How long a screenshot is kept.
 * @returns How many screenshots were deleted.
 */
export async function cleanupExpiredScreenshots(
  objects: ObjectStore,
  now: number,
  retentionMs: number = SCREENSHOT_RETENTION_MS,
) {
  const cutoff = now - retentionMs;
  let deleted = 0;

  try {
    for await (const key of objects.list(SCREENSHOT_PREFIX)) {
      const parsed = parseApplicationScreenshotKey(key);

      if (parsed === null || parsed.at >= cutoff) {
        continue;
      }

      await objects.delete(key);
      deleted += 1;
    }
  } catch (error) {
    logError("screenshots.cleanup", error);
  }

  return deleted;
}

export function ensureScreenshotCleanupQueued(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, SCREENSHOT_CLEANUP_JOB_KIND, "{}", {
    dedupeKey: SCREENSHOT_CLEANUP_JOB_KIND,
    maxAttempts: 1,
    runAt: clock.now() + CLEANUP_INTERVAL_MS,
  }).inserted;
}

export async function screenshotCleanupJobHandler(deps: {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
}) {
  try {
    return await cleanupExpiredScreenshots(deps.objects, deps.clock.now());
  } finally {
    ensureScreenshotCleanupQueued(deps.db, deps.clock);
  }
}
