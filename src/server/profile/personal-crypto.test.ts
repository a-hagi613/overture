import { describe, expect, test } from "bun:test";

import { userKeys, users } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { createPersonalCrypto } from "./personal-crypto.ts";

const MASTER = new Uint8Array(32).fill(5);

function freshUsers(ids: readonly string[]) {
  const { counter, db } = openCountingDatabase();

  const now = new Date(1_795_000_000_000);

  for (const id of ids) {
    db.insert(users)
      .values({
        id,
        name: `Person ${id}`,
        email: `${id}@example.com`,
        emailVerified: true,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const personal = createPersonalCrypto(db, MASTER, 1);

  return { counter, db, personal };
}

function keyReads(counter: { queries: () => string[] }) {
  return counter.queries().filter((sql) => sql.includes('from "user_keys"')).length;
}

describe("the personal key read", () => {
  test("reads the wrapped key once, however many values one request opens and seals", async () => {
    const { counter, personal } = freshUsers(["user-1"]);
    const scope = { column: "value_enc", rowId: "r", table: "facts" } as const;

    const sealed = await Promise.all(
      Array.from({ length: 8 }, async (_unused, index) =>
        personal.sealFor("user-1", scope, `answer ${String(index)}`),
      ),
    );

    const opened = await Promise.all(
      sealed.map(async (value) => personal.openFor("user-1", scope, value)),
    );

    expect(opened).toEqual(
      Array.from({ length: 8 }, (_unused, index) => `answer ${String(index)}`),
    );
    expect(keyReads(counter)).toBe(1);
  });

  test("keeps each person's key apart", async () => {
    const { counter, personal } = freshUsers(["user-1", "user-2"]);
    const scope = { column: "value_enc", rowId: "r", table: "facts" } as const;

    const forOne = await personal.sealFor("user-1", scope, "one");
    const forTwo = await personal.sealFor("user-2", scope, "two");

    expect(await personal.openFor("user-1", scope, forOne)).toBe("one");
    expect(await personal.openFor("user-2", scope, forTwo)).toBe("two");
    expect(keyReads(counter)).toBe(2);
  });

  test("creates a key once when two requests race for the same person", async () => {
    const { personal } = freshUsers(["user-1"]);
    const scope = { column: "value_enc", rowId: "r", table: "facts" } as const;

    const [first, second] = await Promise.all([
      personal.sealFor("user-1", scope, "first"),
      personal.sealFor("user-1", scope, "second"),
    ]);

    expect(await personal.openFor("user-1", scope, first)).toBe("first");
    expect(await personal.openFor("user-1", scope, second)).toBe("second");
  });
});

describe("the stored key", () => {
  test("is created once for a person however many reads and writes ask for it", async () => {
    const { db, personal } = freshUsers(["user-1"]);
    const scope = { column: "value_enc", rowId: "r", table: "facts" } as const;

    await personal.sealFor("user-1", scope, "before");

    const reopened = await personal.openFor(
      "user-1",
      scope,
      await personal.sealFor("user-1", scope, "after"),
    );

    expect(reopened).toBe("after");
    expect(db.select().from(userKeys).all()).toHaveLength(1);
  });

  test("a read in flight when a person is forgotten does not cache their key again", async () => {
    const { counter, db, personal } = freshUsers(["user-1"]);
    const scope = { column: "value_enc", rowId: "r", table: "facts" } as const;

    const sealed = await createPersonalCrypto(db, MASTER, 1).sealFor("user-1", scope, "value");

    const inFlight = personal.openFor("user-1", scope, sealed);

    personal.forget("user-1");

    expect(await inFlight).toBe("value");

    await personal.openFor("user-1", scope, sealed);

    expect(keyReads(counter)).toBe(3);
  });

  test("forgetting a person drops their cached key, so the next read comes from the database", async () => {
    const { counter, personal } = freshUsers(["user-1"]);
    const scope = { column: "value_enc", rowId: "r", table: "facts" } as const;

    const sealed = await personal.sealFor("user-1", scope, "value");

    expect(keyReads(counter)).toBe(1);

    personal.forget("user-1");

    expect(await personal.openFor("user-1", scope, sealed)).toBe("value");
    expect(keyReads(counter)).toBe(2);
  });
});
