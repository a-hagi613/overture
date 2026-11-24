import { expect, test } from "bun:test";

import { createEventLoopLagStats } from "./runtime-stats.ts";

test("the rolling lag window keeps the newest samples and reports p95", () => {
  const recorded: number[] = [];
  const stats = createEventLoopLagStats({ capacity: 20, onSample: (lag) => recorded.push(lag) });

  expect(stats.p95()).toBeNull();

  for (let value = 1; value <= 20; value += 1) {
    stats.sample(value);
  }

  expect(stats.p95()).toBe(19);
  expect(stats.size()).toBe(20);

  stats.sample(-5);
  stats.sample(30);

  expect(stats.size()).toBe(20);
  expect(stats.p95()).toBe(20);
  expect(recorded.at(0)).toBe(1);
  expect(recorded.at(-2)).toBe(0);
});
