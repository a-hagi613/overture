import { describe, expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { createSseStream } from "./stream.ts";
import { SSE_USER_SUBSCRIBER_CAP, subscribeToEvents } from "./hub.ts";

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function fillUser(db: ReturnType<typeof migrated>["db"], userId: string) {
  const stops: (() => void)[] = [];

  for (let index = 0; index < SSE_USER_SUBSCRIBER_CAP; index += 1) {
    const stop = subscribeToEvents(db, {
      userId,
      lastSeq: 0,
      deliver: () => undefined,
    });

    if (stop !== null) {
      stops.push(stop);
    }
  }

  return stops;
}

describe("the event stream", () => {
  test("answers a full per-user cap instead of opening another stream", () => {
    const { db, sqlite } = migrated();
    const stops = fillUser(db, "user-a");
    const controller = new AbortController();

    expect(createSseStream(db, null, "user-a", controller.signal)).toBeNull();

    for (const stop of stops) {
      stop();
    }

    sqlite.close();
  });

  test("aborting the request releases the subscription", async () => {
    const { db, sqlite } = migrated();
    const controller = new AbortController();
    const stream = createSseStream(db, null, "user-a", controller.signal);

    expect(stream).not.toBeNull();

    controller.abort();
    await stream?.cancel();

    const stops = fillUser(db, "user-a");

    expect(stops).toHaveLength(SSE_USER_SUBSCRIBER_CAP);

    for (const stop of stops) {
      stop();
    }

    sqlite.close();
  });

  test("cancelling the stream releases the subscription", async () => {
    const { db, sqlite } = migrated();
    const controller = new AbortController();
    const stream = createSseStream(db, null, "user-a", controller.signal);

    expect(stream).not.toBeNull();

    await stream?.cancel();

    const stops = fillUser(db, "user-a");

    expect(stops).toHaveLength(SSE_USER_SUBSCRIBER_CAP);

    for (const stop of stops) {
      stop();
    }

    sqlite.close();
  });
});
