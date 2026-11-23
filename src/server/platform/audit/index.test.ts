import { describe, expect, test } from "bun:test";

import type { AppDatabase } from "../db/client.ts";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { adminAudit } from "../db/schema.ts";

Bun.env.BETTER_AUTH_SECRET ??= "audit-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "audit-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "audit-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { formatAuditCursor, parseAuditCursor, queryAdminAudit } = await import("./index.ts");

const BASE_TIME = Date.UTC(2026, 10, 22, 12, 0, 0);

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function seedAudit(
  db: AppDatabase,
  row: {
    id: string;
    at: number;
    actorId: string;
    action: string;
    targetUserId?: string | null;
    reason?: string;
    detail?: Record<string, string | number | boolean | null>;
  },
) {
  db.insert(adminAudit)
    .values({
      id: row.id,
      at: row.at,
      actorId: row.actorId,
      action: row.action,
      targetUserId: row.targetUserId ?? null,
      reason: row.reason ?? "",
      detail: JSON.stringify(row.detail ?? {}),
    })
    .run();
}

describe("parseAuditCursor", () => {
  test("parses composite timestamp and id cursors and bare timestamps", () => {
    expect(parseAuditCursor("1763812800000:row-a")).toStrictEqual({
      at: 1_763_812_800_000,
      id: "row-a",
    });
    expect(parseAuditCursor("1763812800000")).toStrictEqual({
      at: 1_763_812_800_000,
      id: null,
    });
    expect(parseAuditCursor("not-a-cursor")).toBeNull();
    expect(parseAuditCursor("1763812800000:")).toBeNull();
    expect(parseAuditCursor("")).toBeNull();
  });
});

describe("queryAdminAudit", () => {
  test("filters by action, actorId, targetUserId and free-text query without wildcard injection", () => {
    const { db, sqlite } = migrated();

    seedAudit(db, {
      id: "a1",
      at: BASE_TIME + 1000,
      actorId: "owner-1",
      action: "settings.update",
      reason: "Raised daily cap to 100%",
      detail: { key: "limits.daily_cap", after: "20" },
    });
    seedAudit(db, {
      id: "a2",
      at: BASE_TIME + 2000,
      actorId: "owner-1",
      action: "users.suspend",
      targetUserId: "user-42",
      reason: "Abuse report",
      detail: { email: "abuse@example.test" },
    });
    seedAudit(db, {
      id: "a3",
      at: BASE_TIME + 3000,
      actorId: "owner-2",
      action: "grants.create",
      targetUserId: "user-99",
      reason: "Beta invite grant",
      detail: { quantity: 300 },
    });

    const byAction = queryAdminAudit(db, { action: "users.suspend", limit: 50 });

    expect(byAction.entries.map((entry) => entry.id)).toStrictEqual(["a2"]);
    expect(byAction.nextCursor).toBeNull();

    const byTarget = queryAdminAudit(db, { targetUserId: "user-99", limit: 50 });

    expect(byTarget.entries.map((entry) => entry.id)).toStrictEqual(["a3"]);

    const byActor = queryAdminAudit(db, { actorId: "owner-2", limit: 50 });

    expect(byActor.entries.map((entry) => entry.id)).toStrictEqual(["a3"]);

    const byDetailText = queryAdminAudit(db, { q: "DAILY_CAP", limit: 50 });

    expect(byDetailText.entries.map((entry) => entry.id)).toStrictEqual(["a1"]);

    const literalPercent = queryAdminAudit(db, { q: "100%", limit: 50 });

    expect(literalPercent.entries.map((entry) => entry.id)).toStrictEqual(["a1"]);

    sqlite.close();
  });

  test("paginates deterministically across tied timestamps without skipping or repeating rows", () => {
    const { db, sqlite } = migrated();

    seedAudit(db, { id: "row-1", at: BASE_TIME, actorId: "owner-1", action: "settings.update" });
    seedAudit(db, { id: "row-2", at: BASE_TIME, actorId: "owner-1", action: "settings.update" });
    seedAudit(db, { id: "row-3", at: BASE_TIME, actorId: "owner-1", action: "settings.update" });
    seedAudit(db, {
      id: "row-4",
      at: BASE_TIME + 5000,
      actorId: "owner-1",
      action: "settings.update",
    });

    const page1 = queryAdminAudit(db, { limit: 2 });

    expect(page1.entries.map((entry) => entry.id)).toStrictEqual(["row-4", "row-3"]);
    expect(page1.nextCursor).toBe(formatAuditCursor({ at: BASE_TIME, id: "row-3" }));

    const page2 = queryAdminAudit(db, { before: page1.nextCursor ?? undefined, limit: 2 });

    expect(page2.entries.map((entry) => entry.id)).toStrictEqual(["row-2", "row-1"]);
    expect(page2.nextCursor).toBeNull();

    sqlite.close();
  });
});
