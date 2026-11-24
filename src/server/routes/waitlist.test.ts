import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createWaitlistRoutes } from "./waitlist.ts";
import type { WaitlistSubmit } from "../../shared/waitlist.ts";

const MAX_PER_HOUR = 5;

const confirmationSchema = z.object({ message: z.string(), ok: z.literal(true) });
const refusalSchema = z.object({ error: z.string(), message: z.string(), ok: z.literal(false) });

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

function createTestApp() {
  const { db, sqlite } = openDatabase(":memory:");

  handles.push(sqlite);
  migrateDatabase(db, "drizzle");

  const app = new Hono();

  app.route(
    "/api",
    createWaitlistRoutes({
      clientIpConfig: { flyAppName: undefined, nodeEnv: "test" },
      clock: createClock(),
      db,
    }),
  );

  return { app, sqlite };
}

async function submit(app: Hono, body: WaitlistSubmit, ip = "203.0.113.20") {
  return app.request("/api/waitlist", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    method: "POST",
  });
}

function entryCount(sqlite: ReturnType<typeof openDatabase>["sqlite"]) {
  return z
    .object({ total: z.number() })
    .parse(sqlite.query("select count(*) as total from waitlist_entries").get()).total;
}

describe("POST /api/waitlist", () => {
  test("accepts a stranger and answers the same friendly confirmation every time", async () => {
    const { app, sqlite } = createTestApp();

    const response = await submit(app, {
      email: "Person@Example.com",
      targetLocation: " Montreal",
      targetRole: "Designer",
    });

    expect(response.status).toBe(200);
    expect(confirmationSchema.parse(await response.clone().json()).message).toContain(
      "You're on the list",
    );

    const duplicate = await submit(app, { email: "person@example.com" });

    expect(duplicate.status).toBe(200);
    expect(confirmationSchema.parse(await duplicate.json())).toEqual(
      confirmationSchema.parse(await response.json()),
    );
    expect(entryCount(sqlite)).toBe(1);
  });

  test("a filled honeypot gets the confirmation and writes nothing", async () => {
    const { app, sqlite } = createTestApp();

    const response = await submit(app, {
      company_url: "https://example.com",
      email: "bot@example.com",
    });

    expect(response.status).toBe(200);
    expect(confirmationSchema.parse(await response.json()).ok).toBe(true);
    expect(entryCount(sqlite)).toBe(0);
  });

  test("each client gets five submissions an hour and a sixth is refused with plain copy", async () => {
    const { app } = createTestApp();

    const sent = await Promise.all(
      Array.from({ length: MAX_PER_HOUR }, async (_, index) =>
        submit(app, { email: `person-${String(index)}@example.com` }),
      ),
    );

    expect(sent.every((response) => response.status === 200)).toBe(true);

    const limited = await submit(app, { email: "person-extra@example.com" });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
    expect(refusalSchema.parse(await limited.json())).toMatchObject({
      error: "rate_limited",
      ok: false,
    });

    const other = await submit(app, { email: "other@example.com" }, "203.0.113.21");

    expect(other.status).toBe(200);
  });

  test("refuses an address that is not an email with the shared envelope", async () => {
    const { app, sqlite } = createTestApp();

    const response = await submit(app, { email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(entryCount(sqlite)).toBe(0);
  });
});
