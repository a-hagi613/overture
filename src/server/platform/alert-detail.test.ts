import { describe, expect, test } from "bun:test";

import { unhandledRejectionDetail } from "./alert-detail.ts";

describe("the unhandled-rejection alert detail", () => {
  test("carries only the error type and the count", () => {
    expect(unhandledRejectionDetail("TypeError", 2)).toEqual({ count: 2, error: "TypeError" });
  });

  test("has no message field for personal data to hide in", () => {
    const detail = unhandledRejectionDetail("Error", 1);

    expect(Object.keys(detail).toSorted()).toEqual(["count", "error"]);
  });
});
