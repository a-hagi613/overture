import { describe, expect, test } from "bun:test";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { users } from "../platform/db/schema.ts";
import { createFactService } from "./facts.ts";
import { createPersonalCrypto } from "./personal-crypto.ts";

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return null;
}

function freshFacts() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      id: "user-1",
      name: "Example Owner",
      email: "owner@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const personal = createPersonalCrypto(db, new Uint8Array(32).fill(7), 1);

  return { facts: createFactService({ db, clock, personal }), userId: "user-1" };
}

describe("a Fact's scope", () => {
  test("keeps a salary Fact once per currency", async () => {
    const { facts, userId } = freshFacts();

    await facts.save(userId, "salary_expectation", "CAD 140,000 a year", "CAD");
    await facts.save(userId, "salary_expectation", "USD 95,000 a year", "USD");

    const saved = await facts.list(userId);

    expect(saved.map((record) => [record.scope, record.value])).toEqual([
      ["CAD", "CAD 140,000 a year"],
      ["USD", "USD 95,000 a year"],
    ]);
  });

  test("rejects a scope the Fact's key does not use", async () => {
    const { facts, userId } = freshFacts();

    expect(
      await rejectionOf(facts.save(userId, "salary_expectation", "CAD 140,000 a year", "CA")),
    ).toBe("unknown currency scope: CA");

    expect(await rejectionOf(facts.save(userId, "work_auth", "Citizen", "CAD"))).toBe(
      "unknown country scope: CAD",
    );

    expect(await rejectionOf(facts.save(userId, "current_job_title", "Engineer", "CA"))).toBe(
      "fact key current_job_title is not scoped by country",
    );
  });

  test("removes one scope, or every scope, of a key", async () => {
    const { facts, userId } = freshFacts();

    await facts.save(userId, "salary_expectation", "CAD 140,000 a year", "CAD");
    await facts.save(userId, "salary_expectation", "USD 95,000 a year", "USD");

    expect(await facts.remove(userId, "salary_expectation", "USD")).toBe(1);
    expect((await facts.list(userId)).map((record) => record.scope)).toEqual(["CAD"]);

    expect(await facts.remove(userId, "salary_expectation")).toBe(1);
    expect(await facts.list(userId)).toEqual([]);
  });
});
