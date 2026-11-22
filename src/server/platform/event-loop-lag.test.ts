import { expect, test } from "bun:test";

import { createEventLoopLagMonitor } from "./event-loop-lag.ts";

function monitorWith(thresholdMs: number, cooldownMs = 60_000) {
  const reported: number[] = [];

  const monitor = createEventLoopLagMonitor({
    cooldownMs,
    intervalMs: 1000,
    now: () => 0,
    onLag: (lagMs) => {
      reported.push(Math.round(lagMs));
    },
    thresholdMs,
  });

  return { monitor, reported };
}

test("an on-time tick reports no lag", () => {
  const { monitor, reported } = monitorWith(2000);

  expect(Math.round(monitor.sample(1000))).toBe(0);
  expect(Math.round(monitor.sample(2000))).toBe(0);
  expect(reported).toEqual([]);
});

test("a tick that ran late reports how long the loop was blocked", () => {
  const { monitor, reported } = monitorWith(2000);

  monitor.sample(1000);
  const lag = monitor.sample(6500);

  expect(Math.round(lag)).toBe(4500);
  expect(reported).toEqual([4500]);
});

test("drift under the threshold is not reported, so a busy loop does not spam the log", () => {
  const { monitor, reported } = monitorWith(2000);

  monitor.sample(1000);
  monitor.sample(2400);
  monitor.sample(3800);

  expect(reported).toEqual([]);
});

test("a repeated stall inside the cooldown is measured but reported once", () => {
  const { monitor, reported } = monitorWith(2000, 10_000);

  monitor.sample(1000);
  monitor.sample(6000);
  monitor.sample(11_000);

  expect(reported).toEqual([4000]);
});

test("the next stall after the cooldown is reported again", () => {
  const { monitor, reported } = monitorWith(2000, 10_000);

  monitor.sample(1000);
  monitor.sample(6000);
  monitor.sample(11_000);
  monitor.sample(22_000);

  expect(reported).toEqual([4000, 10_000]);
});
