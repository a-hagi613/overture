import { describe, expect, test } from "bun:test";

import type { SendPlanField } from "../../pipeline/send-plan.ts";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

const { planFieldSignature, selfHealRequest } = await import("./self-heal.ts");

const field = (fieldName: string | null, label: string) =>
  ({
    answer: "Yes",
    answerKind: "fact",
    block: null,
    factKey: null,
    factRevision: null,
    fieldName,
    fieldType: "text",
    file: null,
    label,
    options: [],
    questionId: `question-${label}`,
    required: true,
    scope: "",
    sentences: [],
    source: null,
    unit: null,
  }) satisfies SendPlanField;

describe("planFieldSignature", () => {
  test("is stable across field order and changes when a field name changes", () => {
    const one = planFieldSignature("breezy", [
      field("first_name", "First name"),
      field("phone", "Phone"),
    ]);

    const reordered = planFieldSignature("breezy", [
      field("phone", "Phone"),
      field("first_name", "First name"),
    ]);

    expect(one).toBe(reordered);
    expect(one).toHaveLength(16);
    expect(planFieldSignature("breezy", [field("given_name", "First name")])).not.toBe(one);
    expect(planFieldSignature("lever", [field("first_name", "First name")])).not.toBe(one);
  });

  test("falls back to the label when a board sends no field name", () => {
    expect(planFieldSignature("breezy", [field(null, "First name")])).toBe(
      planFieldSignature("breezy", [field("", "First name")]),
    );
  });
});

describe("selfHealRequest", () => {
  test("carries the snapshot as text and asks only for a safe structured patch", () => {
    const request = selfHealRequest({
      ats: "breezy",
      field: field("referral_source", "Referral source code"),
      snapshot: '- form:\n  - textbox "Referral source code": #moved-control',
    });

    expect(request.purpose).toBe("form_self_heal");
    expect(request.user).toContain("#moved-control");
    expect(request.user).toContain("referral_source");
    expect(request.schema.required).toEqual(["selector", "action", "confidence"]);
    expect(request.system).toContain("Never return a button");
  });

  test("bounds a huge snapshot so an outage cannot send an unbounded prompt", () => {
    const request = selfHealRequest({
      ats: "breezy",
      field: field("referral_source", "Referral source"),
      snapshot: "x".repeat(50_000),
    });

    expect(request.user.length).toBeLessThan(13_000);
  });
});
