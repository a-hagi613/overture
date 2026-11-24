import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { grants, users } from "./db/schema.ts";
import { activeSubscriberCount, payingGrantsAt } from "./budgets.ts";

const NOW = 1_795_000_000_000;
const DAY_MS = 86_400_000;

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function addUser(db: ReturnType<typeof database>["db"], id: string) {
  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();

  if (existing !== undefined) {
    return;
  }

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: `${id}@example.com`,
      emailVerified: true,
      id,
      name: id,
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();
}

function addGrant(
  db: ReturnType<typeof database>["db"],
  input: {
    expiresAt: number | null;
    id: string;
    quantity?: number;
    source: "period" | "trial" | "admin";
    startsAt: number;
    userId: string;
  },
) {
  addUser(db, input.userId);

  db.insert(grants)
    .values({
      createdAt: input.startsAt,
      expiresAt: input.expiresAt,
      id: input.id,
      quantity: input.quantity ?? 250,
      source: input.source,
      startsAt: input.startsAt,
      userId: input.userId,
    })
    .run();
}

describe("the active paying subscriber count", () => {
  test("counts the people with a running paid period, once each, and never trial or admin grants", () => {
    const { db } = database();

    addGrant(db, {
      expiresAt: NOW + DAY_MS,
      id: "period-a",
      source: "period",
      startsAt: NOW - DAY_MS,
      userId: "a",
    });
    addGrant(db, {
      expiresAt: NOW + DAY_MS,
      id: "period-a-overlap",
      source: "period",
      startsAt: NOW - DAY_MS,
      userId: "a",
    });
    addGrant(db, {
      expiresAt: NOW + DAY_MS,
      id: "period-b",
      source: "period",
      startsAt: NOW - DAY_MS,
      userId: "b",
    });
    addGrant(db, {
      expiresAt: NOW - DAY_MS,
      id: "period-expired",
      source: "period",
      startsAt: NOW - 10 * DAY_MS,
      userId: "c",
    });
    addGrant(db, {
      expiresAt: NOW + DAY_MS,
      id: "trial-d",
      quantity: 3,
      source: "trial",
      startsAt: NOW - DAY_MS,
      userId: "d",
    });

    expect(activeSubscriberCount(db, NOW)).toBe(2);
  });

  test("reads the covering index, never the grants table", () => {
    const { db, sqlite } = database();

    const compiled = db
      .select({ subscribers: sql<number>`count(distinct ${grants.userId})` })
      .from(grants)
      .where(payingGrantsAt(NOW))
      .toSQL();

    const plan = sqlite
      .query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${compiled.sql}`)
      .all()
      .map((row) => row.detail)
      .join("\n");

    expect(plan).toContain("USING COVERING INDEX grants_paying_subscribers");
    expect(plan).not.toMatch(/SCAN grants\b(?! USING COVERING INDEX)/u);
  });

  test("the migrated schema carries the covering index on the ledger", () => {
    const { sqlite } = database();

    const index = sqlite
      .query<{ name: string; sql: string }, []>(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'grants'",
      )
      .all()
      .find((row) => row.name === "grants_paying_subscribers");

    expect(index?.sql).toContain("(`source`,`starts_at`,`expires_at`,`user_id`)");
  });

  test("the subscriptions table keeps the two indexes its own lookups use", () => {
    const { sqlite } = database();

    const names = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'subscriptions'",
      )
      .all()
      .map((row) => row.name)
      .filter((name) => !name.startsWith("sqlite_autoindex"))
      .toSorted();

    expect(names).toEqual(["subscriptions_stripe_subscription_id_unique", "subscriptions_user"]);
  });
});
