import { expect, test } from "bun:test";

import { stripeModeOf } from "./report.ts";

test("a Stripe secret or restricted key names live or test without quoting the key", () => {
  expect(stripeModeOf("sk_live_abc")).toBe("live");
  expect(stripeModeOf("rk_live_abc")).toBe("live");
  expect(stripeModeOf("sk_test_abc")).toBe("test");
  expect(stripeModeOf("rk_test_abc")).toBe("test");
});

test("no key, or an unrecognised one, is unconfigured", () => {
  expect(stripeModeOf(undefined)).toBe("unconfigured");
  expect(stripeModeOf("pk_live_abc")).toBe("unconfigured");
  expect(stripeModeOf("")).toBe("unconfigured");
});
