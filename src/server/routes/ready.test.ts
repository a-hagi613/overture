import { describe, expect, test } from "bun:test";

Bun.env.BETTER_AUTH_SECRET ??= "ready-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "ready-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "ready-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { approvalTelemetryJson, approveAllBody, approveBody, changesOf } =
  await import("./ready.ts");

const { isDraftedProse, planHasGeneratedProse, READY_DWELL_MAX_MS } =
  await import("../../shared/ready-approval.ts");

const SHA = "a".repeat(64);

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

describe("the generated-prose classification", () => {
  test("counts drafted open text and a drafted cover letter", () => {
    expect(
      planHasGeneratedProse([
        { byUser: false, kind: "fact", source: "fact" },
        { byUser: false, kind: "open_text", source: "open_text" },
      ]),
    ).toBe(true);
  });

  test("leaves saved answers and the user's own words bulk-approvable", () => {
    expect(
      planHasGeneratedProse([
        { byUser: false, kind: "fact", source: "fact" },
        { byUser: true, kind: "open_text", source: "open_text" },
        { byUser: false, kind: "open_text", source: null },
      ]),
    ).toBe(false);
  });

  test("never treats an unsaved empty open text as drafted prose", () => {
    expect(isDraftedProse({ byUser: false, kind: "open_text", source: null })).toBe(false);
  });
});

describe("the approval request bodies", () => {
  test("accept a bounded dwell time", () => {
    expect(approveBody.parse({ dwellMs: 0, planSha256: SHA }).dwellMs).toBe(0);
    expect(approveBody.parse({ dwellMs: READY_DWELL_MAX_MS, planSha256: SHA }).dwellMs).toBe(
      READY_DWELL_MAX_MS,
    );
    expect(approveBody.parse({ planSha256: SHA }).dwellMs).toBeUndefined();
  });

  test("refuse a dwell time that is negative, fractional or a day or more", () => {
    for (const dwellMs of [-1, 1.5, READY_DWELL_MAX_MS + 1]) {
      expect(approveBody.safeParse({ dwellMs, planSha256: SHA }).success).toBe(false);
    }
  });

  test("carry the same bound on a batch approval", () => {
    expect(
      approveAllBody.parse({ dwellMs: 5000, items: [{ id: "app-1", planSha256: SHA }] }).dwellMs,
    ).toBe(5000);
    expect(
      approveAllBody.safeParse({
        dwellMs: READY_DWELL_MAX_MS + 1,
        items: [{ id: "app-1", planSha256: SHA }],
      }).success,
    ).toBe(false);
  });
});

describe("the ready.approve telemetry event", () => {
  test("carries the mode, the dwell time and whether prose was drafted", () => {
    expect(
      JSON.parse(approvalTelemetryJson({ dwellMs: 4200, hasGeneratedProse: true, mode: "single" })),
    ).toEqual({ dwellMs: 4200, hasGeneratedProse: true, mode: "single" });
  });

  test("adds the count for a batch and leaves a missing dwell time null", () => {
    expect(
      JSON.parse(approvalTelemetryJson({ count: 3, hasGeneratedProse: false, mode: "batch" })),
    ).toEqual({ count: 3, dwellMs: null, hasGeneratedProse: false, mode: "batch" });
  });

  test("names no Application or user", () => {
    const event = approvalTelemetryJson({ dwellMs: 10, hasGeneratedProse: false, mode: "single" });

    expect(event).not.toContain("application");
    expect(event).not.toContain("user");
  });
});
