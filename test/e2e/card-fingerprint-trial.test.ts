import { expect, test } from "@playwright/test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../../src/server/platform/db/client.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { cardFingerprints, grants, users } from "../../src/server/platform/db/schema.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";

import {
  cardFingerprintHmac,
  claimTrialCard,
  TRIAL_APPLICATIONS,
} from "../../src/server/billing/card-fingerprint.ts";
import { applicationsLeft, grantApplications } from "../../src/server/billing/ledger.ts";
import { createSpendGate, ungatedSpend } from "../../src/server/billing/spend.ts";

const SECRET = "test-fingerprint-secret-0123456789";
const STRIPE_FINGERPRINT = "fingerprint_card_a";

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const at = new Date(clock.now());

  for (const id of ["user-1", "user-2", "user-3"]) {
    db.insert(users)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        role: "user",
        createdAt: at,
        updatedAt: at,
      })
      .run();
  }

  return { clock, db, sqlite };
}

test.describe("card fingerprint HMAC", () => {
  test("is a keyed SHA-256 hex digest that never equals the raw fingerprint", () => {
    const digest = cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT);

    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest).not.toContain(STRIPE_FINGERPRINT);
    expect(cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT)).toBe(digest);
  });

  test("changes with the secret, so a leaked table cannot be matched without it", () => {
    expect(cardFingerprintHmac("another-secret-0123456789abcdef", STRIPE_FINGERPRINT)).not.toBe(
      cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT),
    );
  });
});

test.describe("the one-time trial grant", () => {
  test("grants three Applications on the first card and stores only the HMAC", () => {
    const { clock, db } = freshDatabase();
    const hmac = cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT);

    const result = claimTrialCard(db, clock, { hmac, userId: "user-1" });

    expect(result).toEqual({ status: "granted" });
    expect(TRIAL_APPLICATIONS).toBe(3);
    expect(applicationsLeft(db, "user-1", clock.now())).toBe(3);

    const row = db.select().from(cardFingerprints).where(eq(cardFingerprints.hmac, hmac)).get();

    expect(row?.trialUsedAt).not.toBeNull();
  });

  test("a retry by the same account and card does not grant twice", () => {
    const { clock, db } = freshDatabase();
    const hmac = cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT);

    claimTrialCard(db, clock, { hmac, userId: "user-1" });

    expect(claimTrialCard(db, clock, { hmac, userId: "user-1" })).toEqual({ status: "granted" });
    expect(applicationsLeft(db, "user-1", clock.now())).toBe(3);
  });

  test("refuses a second account on the same card and grants it nothing", () => {
    const { clock, db } = freshDatabase();
    const hmac = cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT);

    claimTrialCard(db, clock, { hmac, userId: "user-1" });

    expect(claimTrialCard(db, clock, { hmac, userId: "user-2" })).toEqual({
      status: "already_used",
    });
    expect(applicationsLeft(db, "user-2", clock.now())).toBe(0);
  });

  test("keeps refusing the card after the first account is deleted", () => {
    const { clock, db } = freshDatabase();
    const hmac = cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT);

    claimTrialCard(db, clock, { hmac, userId: "user-1" });
    db.delete(users).where(eq(users.id, "user-1")).run();

    expect(db.select().from(grants).where(eq(grants.userId, "user-1")).all()).toEqual([]);
    expect(claimTrialCard(db, clock, { hmac, userId: "user-3" })).toEqual({
      status: "already_used",
    });
  });

  test("an account gets at most one trial, even on a new card", () => {
    const { clock, db } = freshDatabase();

    claimTrialCard(db, clock, {
      hmac: cardFingerprintHmac(SECRET, STRIPE_FINGERPRINT),
      userId: "user-1",
    });

    expect(
      claimTrialCard(db, clock, {
        hmac: cardFingerprintHmac(SECRET, "fingerprint_card_b"),
        userId: "user-1",
      }),
    ).toEqual({ status: "already_trialed" });
    expect(applicationsLeft(db, "user-1", clock.now())).toBe(3);
  });
});

test.describe("preparation gate input", () => {
  test("an account with no trial card and no paid plan has no Applications to prepare with", () => {
    const { clock, db } = freshDatabase();

    expect(applicationsLeft(db, "user-2", clock.now())).toBe(0);
  });
});

test.describe("the spend gate", () => {
  test("lets everyone spend when invite-only and billing is off", () => {
    const { clock, db } = freshDatabase();
    const gate = createSpendGate({ clock, db, gated: false });

    expect(gate.gated).toBe(false);
    expect(gate.allows("user-1")).toBe(true);
    expect(ungatedSpend.allows("user-1")).toBe(true);
  });

  test("refuses paid work without Applications left", () => {
    const { clock, db } = freshDatabase();
    const gate = createSpendGate({ clock, db, gated: true });

    expect(gate.allows("user-1")).toBe(false);
  });

  test("allows paid work once a trial or plan grants Applications", () => {
    const { clock, db } = freshDatabase();

    grantApplications(db, clock, {
      idempotencyKey: "trial:1",
      quantity: 3,
      source: "trial",
      userId: "user-1",
    });

    const gate = createSpendGate({ clock, db, gated: true });

    expect(gate.allows("user-1")).toBe(true);
  });

  test("refuses again once the grant expires", () => {
    const { clock, db } = freshDatabase();
    const at = clock.now();

    grantApplications(db, clock, {
      expiresAt: at + 1,
      idempotencyKey: "trial:expired",
      quantity: 3,
      source: "trial",
      userId: "user-1",
    });

    clock.setOffset(2000);

    const gate = createSpendGate({ clock, db, gated: true });

    expect(gate.allows("user-1")).toBe(false);
  });
});
