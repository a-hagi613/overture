import { describe, expect, test } from "bun:test";

import type { AppDatabase } from "../platform/db/client.ts";
import type { AdminEnv } from "../routes/admin-refusals.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { users } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";

Bun.env.BETTER_AUTH_SECRET ??= "access-owner-test-secret-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(9)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { nameFromEmail, resolveAdminAccessOwner } = await import("./access-owner.ts");

function freshDb() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function insertUser(
  db: AppDatabase,
  row: {
    email: string;
    emailVerified?: boolean;
    id: string;
    role?: "demo" | "owner" | "user";
    suspendedAt?: Date | null;
  },
) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  db.insert(users)
    .values({
      createdAt: now,
      email: row.email,
      emailVerified: row.emailVerified ?? true,
      id: row.id,
      name: row.id,
      role: row.role ?? "user",
      suspendedAt: row.suspendedAt ?? null,
      updatedAt: now,
    })
    .run();
}

const clock = createClock();

describe("nameFromEmail", () => {
  test("turns the local part into a short human name", () => {
    expect(nameFromEmail("maya.okafor@example.com")).toBe("Maya Okafor");
    expect(nameFromEmail("maya_okafor+admin@example.com")).toBe("Maya Okafor Admin");
    expect(nameFromEmail("owner@example.com")).toBe("Owner");
  });
});

describe("resolveAdminAccessOwner", () => {
  test("a fresh owner arriving straight at the admin creates a verified owner row", async () => {
    const db = freshDb();

    const resolved = await resolveAdminAccessOwner(db, clock, {
      email: " Owner@Example.test ",
      sub: "access-owner",
    });

    expect(resolved.ok).toBe(true);

    if (!resolved.ok) {
      throw new Error("the owner should resolve");
    }

    const row = db
      .select()
      .from(users)
      .all()
      .find((user) => user.id === resolved.owner.userId);

    expect(row?.email).toBe("owner@example.test");
    expect(row?.emailVerified).toBe(true);
    expect(row?.name).toBe("Owner");
    expect(row?.role).toBe("owner");
  });

  test("an existing ordinary account is promoted to owner and verified", async () => {
    const db = freshDb();

    insertUser(db, { email: "owner@example.test", emailVerified: false, id: "user-1" });

    const resolved = await resolveAdminAccessOwner(db, clock, {
      email: "owner@example.test",
      sub: "access-owner",
    });

    expect(resolved).toEqual({
      ok: true,
      owner: { email: "owner@example.test", userId: "user-1" },
    });

    const [row] = db.select().from(users).all();

    expect(row?.role).toBe("owner");
    expect(row?.emailVerified).toBe(true);
  });

  test("an address stored with different case resolves through the canonical mailbox", async () => {
    const db = freshDb();

    insertUser(db, { email: "Owner@Example.test", id: "mixed-case-owner" });

    const resolved = await resolveAdminAccessOwner(db, clock, {
      email: " owner@example.test ",
      sub: "access-owner",
    });

    expect(resolved.ok).toBe(true);

    if (!resolved.ok) {
      throw new Error("the owner should resolve");
    }

    expect(resolved.owner.userId).toBe("mixed-case-owner");
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  test("a non-owner Access identity is refused and creates no row", async () => {
    const db = freshDb();

    const resolved = await resolveAdminAccessOwner(db, clock, {
      email: "someone.else@example.com",
      sub: "access-outsider",
    });

    expect(resolved).toEqual({ code: "owner_required", ok: false });
    expect(db.select().from(users).all()).toEqual([]);
  });

  test("a suspended owner is refused", async () => {
    const db = freshDb();

    insertUser(db, {
      email: "owner@example.test",
      id: "suspended-owner",
      role: "owner",
      suspendedAt: new Date("2025-12-01T00:00:00.000Z"),
    });

    const resolved = await resolveAdminAccessOwner(db, clock, {
      email: "owner@example.test",
      sub: "access-owner",
    });

    expect(resolved).toEqual({ code: "owner_required", ok: false });
  });
});

describe("opening a Reveal", () => {
  test("records the owner's real passkey assertion, never a fabricated one", async () => {
    const { createPersonalCrypto } = await import("../profile/personal-crypto.ts");
    const { masterKeyringFor } = await import("../platform/crypto.ts");
    const { createAdminRevealRoutes } = await import("../routes/admin-reveal.ts");
    const { Hono } = await import("hono");
    const { eq } = await import("drizzle-orm");
    const { adminAudit } = await import("../platform/db/schema.ts");

    const db = freshDb();

    insertUser(db, { email: "owner@example.test", id: "owner-1", role: "owner" });
    insertUser(db, { email: "person@example.test", id: "user-42" });

    const app = new Hono<AdminEnv>();

    app.use("*", async (context, next) => {
      context.set("owner", { email: "owner@example.test", userId: "owner-1" });
      await next();
    });

    app.route(
      "/",
      createAdminRevealRoutes(
        db,
        clock,
        createPersonalCrypto(db, masterKeyringFor(new Uint8Array(32).fill(9))),
      ),
    );

    const response = await app.request("/users/user-42/reveal", {
      body: JSON.stringify({ reason: "Support request 118" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);

    const row = db.select().from(adminAudit).where(eq(adminAudit.action, "reveal.open")).get();

    expect(JSON.parse(row?.detail ?? "{}")).toMatchObject({ passkeyAssertedAt: null });
  });
});
