import { afterAll, describe, expect, test } from "bun:test";

import type { AppDatabase } from "./db/client.ts";

import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { events, users } from "./db/schema.ts";
import { subscribeToEvents } from "./sse/hub.ts";

Bun.env.BETTER_AUTH_SECRET ??= "alerts-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "alerts-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "alerts-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const pushRequests: { body: string; method: string; title: string | null }[] = [];

const ntfy = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const title = request.headers.get("title");

    pushRequests.push({ body: await request.text(), method: request.method, title });

    return title === "Overture alert: health"
      ? new Response("moved", { headers: { location: "/elsewhere" }, status: 302 })
      : new Response(null, { status: 204 });
  },
});

const ntfyUrl = `http://127.0.0.1:${String(ntfy.port)}/topic`;

afterAll(() => {
  void ntfy.stop(true);
});

const { pushToPhone, raiseAlert } = await import("./alerts.ts");

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

const clock = { now: () => NOW };

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function seedUser(db: AppDatabase, id: string, role: "owner" | "user") {
  db.insert(users)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      role,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
}

describe("raising an alert", () => {
  test("the alert event goes to every owner and never to a regular user", () => {
    const { db, sqlite } = migrated();

    seedUser(db, "owner-one", "owner");
    seedUser(db, "owner-two", "owner");
    seedUser(db, "member", "user");

    const ownerTopics: string[] = [];
    const memberTopics: string[] = [];

    const stopOwner = subscribeToEvents(db, {
      userId: "owner-one",
      lastSeq: 0,
      deliver: (row) => ownerTopics.push(row.topic),
    });

    const stopMember = subscribeToEvents(db, {
      userId: "member",
      lastSeq: 0,
      deliver: (row) => memberTopics.push(row.topic),
    });

    raiseAlert(db, clock, "llm.spend", { spent: 42 });

    const stopFlush = subscribeToEvents(db, {
      userId: "flush",
      lastSeq: 0,
      deliver: () => undefined,
    });

    stopFlush?.();
    stopOwner?.();
    stopMember?.();

    expect(ownerTopics).toContain("alert.raised");
    expect(memberTopics).toEqual([]);

    const rows = db.select().from(events).all();
    const alertRows = rows.filter((row) => row.topic === "alert.raised");

    expect(alertRows.map((row) => row.userId)).toEqual(["owner-one", "owner-two"]);
    expect(rows.some((row) => row.topic === "alert.raised" && row.userId === null)).toBe(false);

    sqlite.close();
  });

  test("a user with no owner role receives nothing even when no owner exists", () => {
    const { db, sqlite } = migrated();

    seedUser(db, "member", "user");

    const topics: string[] = [];

    const stop = subscribeToEvents(db, {
      userId: "member",
      lastSeq: 0,
      deliver: (row) => topics.push(row.topic),
    });

    raiseAlert(db, clock, "disk", { ok: false });

    stop?.();

    const rows = db.select().from(events).all();

    sqlite.close();

    expect(topics).toEqual([]);
    expect(rows).toEqual([]);
  });
});

describe("pushing an alert to the owner's phone", () => {
  test("posts the kind and detail to the configured ntfy topic", async () => {
    await pushToPhone("llm.spend", { spent: 42 }, ntfyUrl);

    expect(pushRequests.at(-1)).toEqual({
      body: JSON.stringify({ spent: 42 }),
      method: "POST",
      title: "Overture alert: llm.spend",
    });
  });

  test("never follows a redirect, so one push is one request", async () => {
    const before = pushRequests.length;

    await pushToPhone("health", { ok: false }, ntfyUrl);

    expect(pushRequests.length).toBe(before + 1);
  });

  test("no configured topic sends nothing", async () => {
    const before = pushRequests.length;

    await pushToPhone("disk", { ok: false }, undefined);

    expect(pushRequests.length).toBe(before);
  });
});
