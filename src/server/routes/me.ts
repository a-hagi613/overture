import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { readSession } from "../auth/session.ts";
import { enabledSocialProviders } from "../auth/index.ts";
import { env } from "../config/env.ts";
import { hostnameFromHeader, isAdminHost } from "../host-routing.ts";
import { accessVerifier } from "../platform/access/configured.ts";
import { users } from "../platform/db/schema.ts";
import { resolveAdminAccessOwner } from "../admin/access-owner.ts";
import { mePayload, meUserOfOwnerRow } from "./me-payload.ts";

async function adminAccessMeUser(db: AppDatabase, clock: Clock, request: Request) {
  if (accessVerifier === null) {
    return null;
  }

  const identity = await accessVerifier.verify(request);

  if (identity === null) {
    return null;
  }

  const resolved = await resolveAdminAccessOwner(db, clock, identity);

  if (!resolved.ok) {
    return "refused";
  }

  const row = db.select().from(users).where(eq(users.id, resolved.owner.userId)).get();

  return row === undefined ? "refused" : meUserOfOwnerRow(row);
}

export function createMeRoutes(auth: Auth, db: AppDatabase, clock: Clock) {
  const routes = new Hono();

  routes.get("/me", async (context) => {
    const hostname = hostnameFromHeader(context.req.header("host"));
    const onAdminHost = isAdminHost(hostname, env.ADMIN_ORIGIN);

    if (onAdminHost) {
      const accessUser = await adminAccessMeUser(db, clock, context.req.raw);

      if (accessUser !== null) {
        return context.json(
          mePayload(accessUser === "refused" ? null : accessUser, {
            adminOrigin: env.ADMIN_ORIGIN,
            adminOwnerEmail: env.OWNER_EMAIL,
            publicSignupEnabled: env.PUBLIC_SIGNUP_ENABLED,
            socialProviders: [],
            turnstileScriptUrl: env.TURNSTILE_SCRIPT_URL,
            turnstileSiteKey: env.TURNSTILE_SITE_KEY,
          }),
        );
      }
    }

    const session = await readSession(auth, context.req.raw.headers);

    return context.json(
      mePayload(session?.user ?? null, {
        adminOrigin: env.ADMIN_ORIGIN,
        adminOwnerEmail: onAdminHost ? env.OWNER_EMAIL : null,
        publicSignupEnabled: env.PUBLIC_SIGNUP_ENABLED,
        socialProviders: onAdminHost ? [] : enabledSocialProviders,
        turnstileScriptUrl: env.TURNSTILE_SCRIPT_URL,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      }),
    );
  });

  return routes;
}
