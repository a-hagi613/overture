import { describe, expect, test } from "bun:test";

import { nextSendAtOf, sendQueueOf } from "./send-queue.ts";

const HOUR_MS = 3_600_000;
const AT = 1_795_000_000_000;

describe("the send queue", () => {
  test("positions the next scheduled send and counts the ones before it", () => {
    const scheduled = [AT + 2 * HOUR_MS, AT - HOUR_MS, AT + HOUR_MS];

    expect(sendQueueOf(scheduled, AT)).toStrictEqual({ position: 2, sendAt: AT + HOUR_MS });
    expect(sendQueueOf(scheduled, AT + HOUR_MS)).toStrictEqual({
      position: 2,
      sendAt: AT + HOUR_MS,
    });
    expect(sendQueueOf(scheduled, AT + 9 * HOUR_MS)).toStrictEqual({
      position: null,
      sendAt: null,
    });
  });

  test("ignores approved Applications that hold no send time", () => {
    expect(sendQueueOf([null, AT + HOUR_MS, null], AT)).toStrictEqual({
      position: 1,
      sendAt: AT + HOUR_MS,
    });
    expect(sendQueueOf([null], AT)).toStrictEqual({ position: null, sendAt: null });
  });

  test("takes the earliest send time, or now when an Approval has no slot yet", () => {
    const scheduled = [AT + 3 * HOUR_MS, AT + HOUR_MS];

    expect(
      nextSendAtOf({
        approved: 2,
        now: AT,
        scheduledFor: scheduled,
      }),
    ).toBe(AT + HOUR_MS);

    expect(
      nextSendAtOf({
        approved: 1,
        now: AT,
        scheduledFor: [null],
      }),
    ).toBe(AT);

    expect(
      nextSendAtOf({
        approved: 0,
        now: AT,
        scheduledFor: [],
      }),
    ).toBeNull();
  });
});
