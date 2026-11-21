import { describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";

import { waitForWake } from "./scheduler.ts";

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
