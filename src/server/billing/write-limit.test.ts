import { afterEach, describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import {
  BILLING_WRITE_LIMIT,
  BILLING_WRITE_RETRY_AFTER_SECONDS,
  billingWriteLimitKey,
  billingWriteRefusal,
} from "./write-limit.ts";

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  handles.push(sqlite);
  migrateDatabase(db, "drizzle");

  return db;
}

describe("the billing write limit", () => {
  test("allows a person's real billing attempts and refuses the script after the cap", async () => {
    const db = migrated();
    const clock = createClock();

    for (let attempt = 0; attempt < BILLING_WRITE_LIMIT.max; attempt += 1) {
      expect(billingWriteRefusal(db, clock, "user-1")).toBeNull();
    }

    const refusal = billingWriteRefusal(db, clock, "user-1");

    expect(refusal?.status).toBe(429);
    expect(refusal?.headers.get("retry-after")).toBe(String(BILLING_WRITE_RETRY_AFTER_SECONDS));
    expect(await refusal?.json()).toEqual({ error: "rate_limited" });
  });

  test("each account counts alone", () => {
    const db = migrated();
    const clock = createClock();

    for (let attempt = 0; attempt < BILLING_WRITE_LIMIT.max; attempt += 1) {
      billingWriteRefusal(db, clock, "user-1");
    }

    expect(billingWriteRefusal(db, clock, "user-1")?.status).toBe(429);
    expect(billingWriteRefusal(db, clock, "user-2")).toBeNull();
  });

  test("the window opens again after it has passed", () => {
    const db = migrated();
    const clock = createClock();

    for (let attempt = 0; attempt < BILLING_WRITE_LIMIT.max; attempt += 1) {
      billingWriteRefusal(db, clock, "user-1");
    }

    expect(billingWriteRefusal(db, clock, "user-1")?.status).toBe(429);

    clock.setOffset(BILLING_WRITE_LIMIT.windowMs + 1);

    expect(billingWriteRefusal(db, clock, "user-1")).toBeNull();
  });

  test("one bucket covers every billing mutation", () => {
    expect(billingWriteLimitKey("user-1")).toBe("api.billing-write:user-1");
  });
});
