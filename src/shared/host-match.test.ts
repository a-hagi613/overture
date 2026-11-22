import { expect, test } from "bun:test";

import { isSameHostOrSubdomain, normaliseHost } from "./host-match.ts";

test("a host matches its own domain", () => {
  expect(isSameHostOrSubdomain("greenhouse.io", "greenhouse.io")).toBe(true);
});

test("a subdomain matches its domain", () => {
  expect(isSameHostOrSubdomain("us.greenhouse-mail.io", "greenhouse-mail.io")).toBe(true);
  expect(isSameHostOrSubdomain("a.b.c.example.com", "example.com")).toBe(true);
});

test("a lookalike suffix is not a subdomain", () => {
  expect(isSameHostOrSubdomain("evilgreenhouse.io", "greenhouse.io")).toBe(false);
  expect(isSameHostOrSubdomain("greenhouse.io.evil.test", "greenhouse.io")).toBe(false);
  expect(isSameHostOrSubdomain("example.com", "other.com")).toBe(false);
});

test("case and a trailing dot are ignored on both sides", () => {
  expect(isSameHostOrSubdomain("US.Greenhouse-Mail.IO.", "greenhouse-mail.io")).toBe(true);
  expect(isSameHostOrSubdomain("workable.com", " Workable.COM. ")).toBe(true);
});

test("an empty domain never matches", () => {
  expect(isSameHostOrSubdomain("example.com", "")).toBe(false);
  expect(isSameHostOrSubdomain("", "")).toBe(false);
});

test("normaliseHost trims, lower-cases and drops one trailing dot", () => {
  expect(normaliseHost("  Example.COM. ")).toBe("example.com");
  expect(normaliseHost("example.com")).toBe("example.com");
});
