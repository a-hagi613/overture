import { describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";

import { migrateDatabase } from "../db/migrate.ts";
import { openDatabase } from "../db/client.ts";
import { enqueueJob, registerEnqueueNotify } from "./queue.ts";
import { startJobWorker, waitForWake } from "./scheduler.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

const clock = { now: () => NOW };

function migrated() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

describe("waitForWake", () => {
  test("a wait that times out leaves no abort listener behind", async () => {
    const controller = new AbortController();

    await waitForWake(1, controller.signal);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  test("repeated waits do not accumulate abort listeners", async () => {
    const controller = new AbortController();

    await Promise.all(
      Array.from({ length: 50 }, async () => {
        await waitForWake(0, controller.signal);
      }),
    );

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  test("an abort ends the wait at once and leaves no listener", async () => {
    const controller = new AbortController();
    const wait = waitForWake(60_000, controller.signal);

    controller.abort();

    await wait;

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  test("the wake callback ends the wait early", async () => {
    const controller = new AbortController();

    await waitForWake(60_000, controller.signal, (wake) => wake());

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  test("an already-aborted signal returns without registering a listener", async () => {
    const controller = new AbortController();

    controller.abort();

    await waitForWake(60_000, controller.signal);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});

describe("the job worker's class limits", () => {
  test("stalled browser jobs do not block a fast notification job", async () => {
    const db = migrated();
    const controller = new AbortController();
    const started: string[] = [];
    const stalled = Promise.withResolvers<undefined>();
    const slowStarted = Promise.withResolvers<undefined>();
    const fastStarted = Promise.withResolvers<undefined>();

    function mark(kind: "fast" | "slow") {
      started.push(kind);

      if (kind === "fast") {
        fastStarted.resolve(undefined);
      }

      if (started.filter((entry) => entry === "slow").length === 3) {
        slowStarted.resolve(undefined);
      }
    }

    const worker = startJobWorker(
      db,
      clock,
      {
        "fixtures.capture": async () => {
          mark("slow");

          await stalled.promise;
        },
        "push.notify": async () => {
          await waitForWake(0, controller.signal);
          mark("fast");
        },
      },
      controller.signal,
      (notify) => {
        registerEnqueueNotify(notify);
      },
    );

    for (let index = 0; index < 20; index += 1) {
      enqueueJob(db, clock, "fixtures.capture", "{}", { runAt: NOW - 20_000 + index });
    }

    await slowStarted.promise;

    enqueueJob(db, clock, "push.notify", "{}", { runAt: NOW });

    await fastStarted.promise;

    expect(started.filter((entry) => entry === "slow")).toHaveLength(3);
    expect(started).toContain("fast");

    controller.abort();
    stalled.resolve(undefined);

    await worker.drain(1000);
  });
});
