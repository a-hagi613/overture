import { describe, expect, test } from "bun:test";

import { createScoreLimiter } from "./limit.ts";

describe("the lab score limiter", () => {
  test("allows the window's maximum and refuses the next attempt", () => {
    const limiter = createScoreLimiter({ limit: 2, now: () => 0, windowMs: 1000 });

    expect(limiter.allow("client-a")).toBe(true);
    expect(limiter.allow("client-a")).toBe(true);
    expect(limiter.allow("client-a")).toBe(false);
  });

  test("expires a client's bucket with its window", () => {
    let now = 0;
    const limiter = createScoreLimiter({ limit: 1, now: () => now, windowMs: 1000 });

    expect(limiter.allow("client-a")).toBe(true);
    expect(limiter.allow("client-a")).toBe(false);

    now = 1000;

    expect(limiter.allow("client-a")).toBe(true);
  });

  test("evicts the oldest buckets once the map is full, so forged keys stay bounded", () => {
    const limiter = createScoreLimiter({ limit: 2, maxKeys: 2, now: () => 0, windowMs: 1000 });

    expect(limiter.allow("client-a")).toBe(true);
    expect(limiter.allow("client-b")).toBe(true);
    expect(limiter.size()).toBe(2);

    expect(limiter.allow("client-c")).toBe(true);
    expect(limiter.size()).toBe(2);

    expect(limiter.allow("client-c")).toBe(true);
    expect(limiter.allow("client-c")).toBe(false);

    expect(limiter.allow("client-a")).toBe(true);
    expect(limiter.size()).toBe(2);
  });

  test("drops expired buckets once the map is full", () => {
    let now = 0;
    const limiter = createScoreLimiter({ limit: 1, maxKeys: 2, now: () => now, windowMs: 1000 });

    expect(limiter.allow("stale-a")).toBe(true);
    expect(limiter.allow("stale-b")).toBe(true);
    expect(limiter.size()).toBe(2);

    now = 2000;

    expect(limiter.allow("live-c")).toBe(true);
    expect(limiter.size()).toBe(1);

    expect(limiter.allow("live-c")).toBe(false);
    expect(limiter.allow("stale-a")).toBe(true);
    expect(limiter.size()).toBe(2);
  });
});
