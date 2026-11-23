import { describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { profiles, users } from "../platform/db/schema.ts";

import { billingUsersPage } from "./admin-view.ts";
import { grantApplications } from "./ledger.ts";

const DAY_MS = 24 * 60 * 60_000;

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function addUser(
  db: ReturnType<typeof database>["db"],
  input: { id: string; pauseReason?: "payment_failed" | null },
) {
  const at = new Date(input.id.length * 1000);

  db.insert(users)
    .values({
      createdAt: at,
      email: `${input.id}@example.com`,
      emailVerified: true,
      id: input.id,
      name: input.id,
      role: "user",
      updatedAt: at,
    })
    .run();

  db.insert(profiles)
    .values({
      createdAt: at,
      languages: "[]",
      pauseReason: input.pauseReason ?? null,
      running: true,
      timezone: "UTC",
      updatedAt: at,
      userId: input.id,
    })
    .run();
}

describe("the admin billing list", () => {
  test("filters and pages in SQL while keeping the stat counts", () => {
    const { db, sqlite } = database();
    const clock = createClock();
    const at = clock.now();

    addUser(db, { id: "alpha" });
    addUser(db, { id: "bravo" });
    addUser(db, { id: "charlie" });
    addUser(db, { id: "delta" });
    addUser(db, { id: "echo", pauseReason: "payment_failed" });

    grantApplications(db, clock, {
      expiresAt: at + 20 * DAY_MS,
      idempotencyKey: "grant:alpha",
      quantity: 250,
      source: "period",
      userId: "alpha",
    });
    grantApplications(db, clock, {
      idempotencyKey: "grant:bravo",
      quantity: 3,
      source: "trial",
      userId: "bravo",
    });
    grantApplications(db, clock, {
      expiresAt: at + 3 * DAY_MS,
      idempotencyKey: "grant:charlie",
      quantity: 50,
      source: "period",
      userId: "charlie",
    });
    grantApplications(db, clock, {
      expiresAt: at - 1000,
      idempotencyKey: "grant:delta",
      quantity: 50,
      source: "period",
      userId: "delta",
    });
    grantApplications(db, clock, {
      idempotencyKey: "grant:echo",
      quantity: 3,
      source: "trial",
      userId: "echo",
    });

    const paying = billingUsersPage(db, clock, { filter: "paying", page: 1 });

    expect(paying.total).toBe(2);
    expect(paying.users.map((user) => user.id)).toEqual(["alpha", "charlie"]);
    expect(paying.users.map((user) => user.state)).toEqual(["paying", "ending"]);

    const trial = billingUsersPage(db, clock, { filter: "trial", page: 1 });

    expect(trial.total).toBe(1);
    expect(trial.users[0]?.id).toBe("bravo");

    const paused = billingUsersPage(db, clock, { filter: "paused", page: 1 });

    expect(paused.users.map((user) => user.id)).toEqual(["echo"]);

    const ended = billingUsersPage(db, clock, { filter: "ended", page: 1 });

    expect(ended.users.map((user) => user.id)).toEqual(["delta"]);

    const all = billingUsersPage(db, clock, { filter: "all", page: 1 });

    expect(all.total).toBe(5);
    expect(all.users.map((user) => user.id)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
    ]);
    expect(all.counts).toEqual({ endingSoon: 1, onTrial: 1, paused: 1, paying: 2 });

    sqlite.close();
  });
});
