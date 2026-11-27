import { describe, expect, test } from "bun:test";

import { allowsUnonboarded } from "./route-guard.ts";

describe("the unonboarded route guard", () => {
  test("keeps the workspace closed until onboarding finishes", () => {
    expect(allowsUnonboarded("/home", "")).toBe(false);
    expect(allowsUnonboarded("/tracker", "")).toBe(false);
    expect(allowsUnonboarded("/onboarding/matches", "")).toBe(false);
  });

  test("opens the account and billing pages a person needs mid-setup", () => {
    expect(allowsUnonboarded("/profile/billing", "")).toBe(true);
    expect(allowsUnonboarded("/settings/export", "")).toBe(true);
  });

  test("lets the Tracker run a Stripe return, and only that Tracker", () => {
    expect(allowsUnonboarded("/tracker", "?card=verified&session=cs_test_1")).toBe(true);
    expect(allowsUnonboarded("/tracker", "?billing=success&plan=week")).toBe(true);
    expect(allowsUnonboarded("/tracker", "?card=cancelled")).toBe(false);
    expect(allowsUnonboarded("/ready", "?card=verified")).toBe(false);
  });
});
