import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";

import { listAdminAuditForUser } from "../platform/audit/index.ts";

const MAX_ENTRIES = 200;

export function createSupportAccessRoutes(db: AppDatabase, auth: Auth) {
  const routes = new Hono();

  routes.get("/support-access", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const session = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    if (session === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const entries = listAdminAuditForUser(db, session.user.id, MAX_ENTRIES).map((row) => ({
      action: row.action,
      at: row.at.getTime(),
      detail: row.detail,
      id: row.id,
      reason: row.reason,
    }));

    return context.json({ entries });
  });

  return routes;
}
