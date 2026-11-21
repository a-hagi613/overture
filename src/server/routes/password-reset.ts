import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { users, verifications } from "../platform/db/schema.ts";

export function createPasswordResetRoutes(db: AppDatabase, clock: Clock) {
  const routes = new Hono();

  routes.get("/password-reset", (context) => {
    const token = context.req.query("token")?.trim() ?? "";

    if (token.length === 0) {
      return context.json({ error: "invalid_token" }, 400);
    }

    const verification = db
      .select({ value: verifications.value })
      .from(verifications)
      .where(
        and(
          eq(verifications.identifier, `reset-password:${token}`),
          gt(verifications.expiresAt, new Date(clock.now())),
        ),
      )
      .get();

    if (verification === undefined) {
      return context.json({ error: "invalid_token" }, 400);
    }

    const user = db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, verification.value))
      .get();

    if (user === undefined) {
      return context.json({ error: "invalid_token" }, 400);
    }

    return context.json({ email: user.email });
  });

  return routes;
}
