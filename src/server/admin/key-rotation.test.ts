import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { MasterKeyring } from "../platform/crypto.ts";

import {
  createUserKey,
  masterKeyringFor,
  openValue,
  parseMasterKeyring,
  sealValue,
  storedUserKeyBlob,
  storedUserKeyFromBlob,
} from "../platform/crypto.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { adminAudit, bgJobs, userKeys, users } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";

Bun.env.BETTER_AUTH_SECRET ??= "admin-key-rotation-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "admin-key-rotation-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "admin-key-rotation-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { enqueueMasterKeyRotation, masterKeyCoverageProblem, runMasterKeyRotation } =
  await import("./key-rotation.ts");

const NOW = 1_795_000_000_000;
const scope = { column: "value_enc", rowId: "fact-1", table: "facts" };

function key(fill: number) {
  return new Uint8Array(32).fill(fill);
}

const v1 = key(1);
const v2 = key(2);

const during: MasterKeyring = {
  current: { bytes: v2, version: 2 },
  keys: [
    { bytes: v1, version: 1 },
    { bytes: v2, version: 2 },
  ],
};

const after: MasterKeyring = {
  current: { bytes: v2, version: 2 },
  keys: [{ bytes: v2, version: 2 }],
};

async function seeded(userCount: number) {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const created = await Promise.all(
    Array.from({ length: userCount }, async () => createUserKey(v1, 1)),
  );

  for (let index = 0; index < userCount; index += 1) {
    const userId = `user-${String(index)}`;
    const userKey = created[index];

    if (userKey === undefined) {
      throw new Error(`no user key was created for ${userId}`);
    }

    db.insert(users)
      .values({
        createdAt: new Date(NOW),
        email: `${userId}@example.com`,
        emailVerified: true,
        id: userId,
        name: userId,
        role: "owner",
        updatedAt: new Date(NOW),
      })
      .run();

    db.insert(userKeys)
      .values({
        createdAt: new Date(NOW),
        masterKeyVersion: 1,
        userId,
        wrappedDek: storedUserKeyBlob(userKey),
      })
      .run();
  }

  return { db, sqlite };
}

function rowOf(db: ReturnType<typeof openDatabase>["db"], userId: string) {
  const row = db.select().from(userKeys).where(eq(userKeys.userId, userId)).get();

  if (row === undefined) {
    throw new Error(`no user key for ${userId}`);
  }

  return row;
}

function auditRows(db: ReturnType<typeof openDatabase>["db"]) {
  return db.select().from(adminAudit).all();
}

describe("the master-key rotation", () => {
  test("re-wraps every row exactly once and leaves the old ciphertext readable", async () => {
    const { db, sqlite } = await seeded(3);
    const clock = createClock();
    const rotatedUsers: string[] = [];

    const sealed = await sealValue(
      masterKeyringFor(v1),
      storedUserKeyFromBlob(rowOf(db, "user-0").wrappedDek, 1),
      scope,
      "the resume text",
    );

    const summary = await runMasterKeyRotation({
      batchRows: 2,
      clock,
      db,
      keyring: during,
      onRotated: (userId) => rotatedUsers.push(userId),
    });

    expect(summary).toStrictEqual({
      batches: 2,
      dryRun: false,
      remaining: 0,
      rotated: 3,
      toVersion: 2,
    });
    expect(rotatedUsers.toSorted()).toEqual(["user-0", "user-1", "user-2"]);

    const blobs = ["user-0", "user-1", "user-2"].map((userId) => {
      expect(rowOf(db, userId).masterKeyVersion).toBe(2);

      return rowOf(db, userId).wrappedDek.toString("base64");
    });

    const rewrapped = storedUserKeyFromBlob(rowOf(db, "user-0").wrappedDek, 2);

    expect(openValue(during, rewrapped, scope, sealed)).resolves.toBe("the resume text");
    expect(openValue(after, rewrapped, scope, sealed)).resolves.toBe("the resume text");

    const audit = auditRows(db);

    expect(audit.filter((row) => row.action === "master_key.rotate")).toHaveLength(2);
    expect(audit.filter((row) => row.action === "master_key.rotate.summary")).toHaveLength(1);
    expect(audit.every((row) => row.actorId === "system:master-key-rotation")).toBe(true);

    const again = await runMasterKeyRotation({ clock, db, keyring: during });

    expect(again).toStrictEqual({
      batches: 0,
      dryRun: false,
      remaining: 0,
      rotated: 0,
      toVersion: 2,
    });
    expect(
      ["user-0", "user-1", "user-2"].map((userId) =>
        rowOf(db, userId).wrappedDek.toString("base64"),
      ),
    ).toEqual(blobs);

    sqlite.close();
  });

  test("an interrupted rotation resumes without re-wrapping a row twice", async () => {
    const { db, sqlite } = await seeded(5);
    const clock = createClock();

    const first = await runMasterKeyRotation({
      batchRows: 2,
      clock,
      db,
      keyring: during,
      maxBatches: 1,
    });

    expect(first).toStrictEqual({
      batches: 1,
      dryRun: false,
      remaining: 3,
      rotated: 2,
      toVersion: 2,
    });

    const done = ["user-0", "user-1"].map((userId) =>
      rowOf(db, userId).wrappedDek.toString("base64"),
    );

    const second = await runMasterKeyRotation({ batchRows: 2, clock, db, keyring: during });

    expect(second).toStrictEqual({
      batches: 2,
      dryRun: false,
      remaining: 0,
      rotated: 3,
      toVersion: 2,
    });

    expect(
      ["user-0", "user-1"].map((userId) => rowOf(db, userId).wrappedDek.toString("base64")),
    ).toEqual(done);
    expect(
      ["user-0", "user-1", "user-2", "user-3", "user-4"].map(
        (userId) => rowOf(db, userId).masterKeyVersion,
      ),
    ).toEqual([2, 2, 2, 2, 2]);

    sqlite.close();
  });

  test("a dry run only counts and writes nothing", async () => {
    const { db, sqlite } = await seeded(3);
    const clock = createClock();

    const before = ["user-0", "user-1", "user-2"].map((userId) =>
      rowOf(db, userId).wrappedDek.toString("base64"),
    );

    const summary = await runMasterKeyRotation({ clock, db, dryRun: true, keyring: during });

    expect(summary).toStrictEqual({
      batches: 0,
      dryRun: true,
      remaining: 3,
      rotated: 0,
      toVersion: 2,
    });
    expect(
      ["user-0", "user-1", "user-2"].map((userId) =>
        rowOf(db, userId).wrappedDek.toString("base64"),
      ),
    ).toEqual(before);
    expect(
      ["user-0", "user-1", "user-2"].map((userId) => rowOf(db, userId).masterKeyVersion),
    ).toEqual([1, 1, 1]);
    expect(auditRows(db)).toHaveLength(0);
    expect(db.select().from(bgJobs).all()).toHaveLength(0);

    sqlite.close();
  });

  test("a staged newer key without a raised current version is refused, not a silent no-op", async () => {
    const { db, sqlite } = await seeded(1);
    const clock = createClock();

    const staged = parseMasterKeyring(
      {
        MASTER_KEY_CURRENT: "1",
        MASTER_KEY_V1: Buffer.from(v1).toString("base64"),
        MASTER_KEY_V2: Buffer.from(v2).toString("base64"),
      },
      1,
    );

    expect(runMasterKeyRotation({ clock, db, dryRun: true, keyring: staged })).rejects.toThrow(
      "MASTER_KEY_V2 is configured but MASTER_KEY_CURRENT is 1",
    );

    sqlite.close();
  });

  test("the boot check refuses a stored version that has no key", async () => {
    const { db, sqlite } = await seeded(2);

    expect(masterKeyCoverageProblem(db, during)).toBeUndefined();
    expect(masterKeyCoverageProblem(db, after)).toContain("2 row(s) under MASTER_KEY_V1");
    expect(masterKeyCoverageProblem(db, after)).toContain("not configured");

    sqlite.close();
  });

  test("the rotation is queued once and the duplicate is reported", () => {
    const { db, sqlite } = openDatabase(":memory:");

    migrateDatabase(db, "drizzle");

    const clock = createClock();
    const first = enqueueMasterKeyRotation(db, clock);
    const duplicate = enqueueMasterKeyRotation(db, clock);
    const dry = enqueueMasterKeyRotation(db, clock, { dryRun: true });

    expect(first.inserted).toBe(true);
    expect(duplicate).toStrictEqual({ id: first.id, inserted: false });
    expect(dry.inserted).toBe(true);
    expect(db.select().from(bgJobs).all()).toHaveLength(2);

    sqlite.close();
  });
});
