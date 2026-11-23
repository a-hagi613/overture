import { describe, expect, test } from "bun:test";

Bun.env.BETTER_AUTH_SECRET ??= "ready-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "ready-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "ready-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { changesOf } = await import("./ready.ts");

describe("the Ready card change list", () => {
  test("reads a stored list of strings", () => {
    expect(changesOf(JSON.stringify(["The form added a question."]))).toEqual([
      "The form added a question.",
    ]);
  });

  test("returns an empty list for a missing or unreadable value", () => {
    for (const value of [null, "{not-json", '"text"', "42", JSON.stringify([1, 2])]) {
      expect(changesOf(value)).toEqual([]);
    }
  });
});
