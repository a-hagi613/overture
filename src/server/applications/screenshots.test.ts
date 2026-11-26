import { describe, expect, test } from "bun:test";

import type { Page } from "playwright-core";

import type { ObjectEntry, ObjectStore } from "../platform/ports/object-store.ts";

import {
  SCREENSHOT_RETENTION_MS,
  applicationScreenshotKey,
  captureSubmitScreenshot,
  cleanupExpiredScreenshots,
  listApplicationScreenshots,
  parseApplicationScreenshotKey,
} from "./screenshots.ts";

const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);
const USER_ID = "user-shots";
const OTHER_USER = "user-other";
const APPLICATION_ID = "application-shots";

function memoryStore() {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();

  const store: ObjectStore = {
    kind: "disk",
    delete: async (key) => {
      files.delete(key);
    },
    get: async (key) => files.get(key) ?? null,
    getStream: async () => null,
    list: async function* list(prefix) {
      for (const key of [...files.keys()].toSorted()) {
        if (key.startsWith(prefix)) {
          yield key;
        }
      }
    },
    listWithSizes: async function* listWithSizes(prefix): AsyncIterable<ObjectEntry> {
      for (const key of [...files.keys()].toSorted()) {
        if (key.startsWith(prefix)) {
          yield { bytes: files.get(key)?.byteLength ?? 0, key };
        }
      }
    },
    put: async (key, data) => {
      files.set(key, data);
    },
    putStream: async () => 0,
  };

  return { files, store };
}

function pageOf(screenshot: () => Promise<Uint8Array>) {
  return { screenshot } as unknown as Page;
}

describe("Submit screenshots", () => {
  test("stores before and after shots under the user and application prefix", async () => {
    const { files, store } = memoryStore();
    const page = pageOf(async () => new Uint8Array([1, 2, 3]));

    const before = await captureSubmitScreenshot(
      { clock: { now: () => NOW }, objects: store },
      {
        applicationId: APPLICATION_ID,
        attemptId: "attempt-1",
        page,
        phase: "before_submit",
        userId: USER_ID,
      },
    );
    const after = await captureSubmitScreenshot(
      { clock: { now: () => NOW + 1 }, objects: store },
      {
        applicationId: APPLICATION_ID,
        attemptId: "attempt-1",
        page,
        phase: "after_submit",
        userId: USER_ID,
      },
    );

    expect(before?.key).toBe(
      applicationScreenshotKey({
        applicationId: APPLICATION_ID,
        at: NOW,
        attemptId: "attempt-1",
        phase: "before_submit",
        userId: USER_ID,
      }),
    );
    expect(after?.phase).toBe("after_submit");
    expect([...files.keys()]).toEqual([
      `screenshots/${USER_ID}/${APPLICATION_ID}/attempt-1-before_submit-${String(NOW)}.png`,
      `screenshots/${USER_ID}/${APPLICATION_ID}/attempt-1-after_submit-${String(NOW + 1)}.png`,
    ]);

    const listed = await listApplicationScreenshots(store, USER_ID, APPLICATION_ID);

    expect(listed.map((shot) => shot.phase)).toEqual(["before_submit", "after_submit"]);
    expect(listed.map((shot) => shot.bytes)).toEqual([3, 3]);
  });

  test("a failed capture never throws and stores nothing", async () => {
    const { files, store } = memoryStore();
    const page = pageOf(async () => {
      throw new Error("page gone");
    });

    expect(
      await captureSubmitScreenshot(
        { clock: { now: () => NOW }, objects: store },
        {
          applicationId: APPLICATION_ID,
          attemptId: "attempt-1",
          page,
          phase: "before_submit",
          userId: USER_ID,
        },
      ),
    ).toBeNull();
    expect(files.size).toBe(0);
  });

  test("cleanup deletes only expired shots and never a foreign key", async () => {
    const { files, store } = memoryStore();
    const oldAt = NOW - SCREENSHOT_RETENTION_MS - 1;
    const freshAt = NOW - 1;

    files.set(
      applicationScreenshotKey({
        applicationId: APPLICATION_ID,
        at: oldAt,
        attemptId: "attempt-old",
        phase: "before_submit",
        userId: USER_ID,
      }),
      new Uint8Array([1]),
    );
    files.set(
      applicationScreenshotKey({
        applicationId: APPLICATION_ID,
        at: freshAt,
        attemptId: "attempt-new",
        phase: "after_submit",
        userId: OTHER_USER,
      }),
      new Uint8Array([2]),
    );
    files.set("files/not-a-screenshot.png", new Uint8Array([3]));

    expect(await cleanupExpiredScreenshots(store, NOW)).toBe(1);
    expect([...files.keys()]).toHaveLength(2);
    expect(parseApplicationScreenshotKey("files/not-a-screenshot.png")).toBeNull();
  });
});
