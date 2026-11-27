import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { profiles, users } from "../platform/db/schema.ts";
import { grantApplications } from "./ledger.ts";
import { createSpendGate } from "./spend.ts";

function freshDb() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { clock: createClock(), db, sqlite };
}

function addUser(
  db: ReturnType<typeof freshDb>["db"],
  clock: ReturnType<typeof freshDb>["clock"],
  input: { id: string; role?: "owner" | "demo" | "user"; onboardedAt?: number | null },
) {
  const at = new Date(clock.now());

  db.insert(users)
    .values({
      createdAt: at,
      email: `${input.id}@example.com`,
      emailVerified: true,
      id: input.id,
      name: input.id,
      role: input.role ?? "user",
      updatedAt: at,
    })
    .run();

  if (input.onboardedAt !== undefined) {
    db.insert(profiles)
      .values({
        createdAt: at,
        onboardedAt: input.onboardedAt === null ? null : new Date(input.onboardedAt),
        updatedAt: at,
        userId: input.id,
      })
      .run();
  }
}

describe("the spend gate", () => {
  test("an ungated install allows every user", () => {
    const { db, clock } = freshDb();
    addUser(db, clock, { id: "user-1" });
    const gate = createSpendGate({ db, clock, gated: false });

    expect(gate.allows("user-1")).toBe(true);
    expect(gate.allowsOnboarding("user-1")).toBe(true);
  });

  test("a gated install blocks work for a user with no Applications left", () => {
    const { db, clock } = freshDb();
    addUser(db, clock, { id: "user-1", onboardedAt: clock.now() });
    const gate = createSpendGate({ db, clock, gated: true });

    expect(gate.allows("user-1")).toBe(false);
  });

  test("onboarding AI is allowed before the person finishes setup, and only then", () => {
    const { db, clock } = freshDb();
    addUser(db, clock, { id: "new-user", onboardedAt: null });
    addUser(db, clock, { id: "no-profile" });
    addUser(db, clock, { id: "onboarded", onboardedAt: clock.now() });
    addUser(db, clock, { id: "owner", onboardedAt: null, role: "owner" });
    const gate = createSpendGate({ db, clock, gated: true });

    expect(gate.allowsOnboarding("new-user")).toBe(true);
    expect(gate.allowsOnboarding("no-profile")).toBe(true);
    expect(gate.allowsOnboarding("onboarded")).toBe(false);
    expect(gate.allowsOnboarding("owner")).toBe(false);
    expect(gate.allows("new-user")).toBe(false);
  });

  test("an Application left allows onboarding AI after setup, and every later call", () => {
    const { db, clock } = freshDb();
    addUser(db, clock, { id: "user-1", onboardedAt: clock.now() });
    const gate = createSpendGate({ db, clock, gated: true });

    grantApplications(db, clock, {
      expiresAt: null,
      idempotencyKey: "test-grant",
      quantity: 3,
      source: "admin",
      startsAt: clock.now(),
      userId: "user-1",
    });

    expect(gate.allowsOnboarding("user-1")).toBe(true);
    expect(gate.allows("user-1")).toBe(true);

    db.update(profiles).set({ onboardedAt: null }).where(eq(profiles.userId, "user-1")).run();
  });
});
