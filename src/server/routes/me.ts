import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";

import { readSession } from "../auth/session.ts";
import { enabledSocialProviders } from "../auth/index.ts";

import { env } from "../config/env.ts";
import { hostnameFromHeader, isAdminHost } from "../host-routing.ts";
import { mePayload } from "./me-payload.ts";

export function createMeRoutes(auth: Auth) {
  const routes = new Hono();

  routes.get("/me", async (context) => {
    const session = await readSession(auth, context.req.raw.headers);
    const hostname = hostnameFromHeader(context.req.header("host"));
    const onAdminHost = isAdminHost(hostname, env.ADMIN_ORIGIN);

    return context.json(
      mePayload(session?.user ?? null, {
        adminOrigin: env.ADMIN_ORIGIN,
        adminOwnerEmail: onAdminHost ? env.OWNER_EMAIL : null,
        socialProviders: onAdminHost ? [] : enabledSocialProviders,
        turnstileScriptUrl: env.TURNSTILE_SCRIPT_URL,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      }),
    );
  });

  return routes;
}
