import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import { enabledSocialProviders } from "../auth/index.ts";

import { env } from "../config/env.ts";

export function createMeRoutes(auth: Auth) {
  const routes = new Hono();

  routes.get("/me", async (context) => {
    const result = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    const session = result ?? null;

    return context.json({
      user: session
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
            role: session.user.role,
          }
        : null,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      turnstileScriptUrl: env.TURNSTILE_SCRIPT_URL,
      socialProviders: enabledSocialProviders,
    });
  });

  return routes;
}
