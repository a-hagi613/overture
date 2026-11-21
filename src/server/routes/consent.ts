import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import type { ConsentService } from "../profile/consent.ts";

import { consentAcceptInputSchema } from "../../shared/consent.ts";

function versionView(row: { publishedAt: Date; text: string; version: string }) {
  return {
    publishedAt: row.publishedAt.toISOString(),
    text: row.text,
    version: row.version,
  };
}

export function createConsentRoutes(deps: { auth: Auth; consent: ConsentService }) {
  const { auth, consent } = deps;
  const routes = new Hono();

  async function sessionUser(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result?.user ?? null;
  }

  routes.get("/consent", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      const current = consent.current();

      if (current === null) {
        return context.json({ error: "no_version" }, 503);
      }

      return context.json({ accepted: null, current: versionView(current) });
    }

    const state = consent.read(user.id);

    return context.json({
      accepted:
        state.accepted === null
          ? null
          : { at: state.accepted.at.toISOString(), version: state.accepted.version },
      current: versionView(state.current),
    });
  });

  routes.get("/consent/versions", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    return context.json({ versions: consent.list().map((row) => versionView(row)) });
  });

  routes.post("/consent/accept", zValidator("json", consentAcceptInputSchema), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const result = consent.accept(user.id, context.req.valid("json").version);

    if ("error" in result) {
      if (result.error === "version_changed") {
        return context.json({ current: versionView(result.current), error: result.error }, 409);
      }

      return context.json({ error: result.error }, 503);
    }

    const state = consent.read(user.id);

    return context.json({
      accepted: { at: result.accepted.at.toISOString(), version: result.accepted.version },
      current: versionView(state.current),
    });
  });

  return routes;
}
