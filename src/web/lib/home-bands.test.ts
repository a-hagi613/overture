import { describe, expect, test } from "bun:test";

import { isAllCaughtUp, rangeDays } from "./home-bands.ts";

const busy = {
  failed: [],
  readyCount: 0,
  reviewTotal: 0,
};

describe("rangeDays", () => {
  test("maps each Home range to its length", () => {
    expect(rangeDays("7D")).toBe(7);
    expect(rangeDays("30D")).toBe(30);
    expect(rangeDays("90D")).toBe(90);
  });
});

describe("isAllCaughtUp", () => {
  test("is true only when every action is clear", () => {
    expect(isAllCaughtUp(busy, false)).toBe(true);
  });

  test("a verification code asking for a paste is an action", () => {
    expect(isAllCaughtUp(busy, true)).toBe(false);
  });

  test("an open Review is an action", () => {
    expect(isAllCaughtUp({ ...busy, reviewTotal: 1 }, false)).toBe(false);
  });

  test("a Ready approval is an action", () => {
    expect(isAllCaughtUp({ ...busy, readyCount: 2 }, false)).toBe(false);
  });

  test("an unresolved failure is an action", () => {
    expect(isAllCaughtUp({ ...busy, failed: [{}] }, false)).toBe(false);
  });
});
