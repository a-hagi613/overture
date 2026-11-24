import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { ClientIpConfig } from "../auth/client-ip.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { clientIp } from "../auth/client-ip.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";
import { recordWaitlistEntry } from "../waitlist/store.ts";
import { validJson } from "./validators.ts";
import {
  WAITLIST_HONEYPOT_FIELDS,
  waitlistConfirmation,
  waitlistRateLimited,
  waitlistSubmitSchema,
} from "../../shared/waitlist.ts";

const WAITLIST_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 } as const;
const SHARED_CLIENT_KEY = "shared";

function honeypotFilled(body: { company_url?: string | undefined; website?: string | undefined }) {
  return WAITLIST_HONEYPOT_FIELDS.some((field) => (body[field] ?? "").trim() !== "");
}

/**
 * The public waitlist (WS-22). It is frictionless on purpose: no Turnstile and no CAPTCHA, only a per-IP hourly
 * limit and an invisible honeypot. A bot that fills the honeypot, or an email that is already on the list, gets the
 * same friendly confirmation as a fresh sign-up, so the endpoint never reveals an account or invite state.
 * @param deps The application database, the clock, and the proxy configuration that makes a client IP trustworthy.
 * @returns The Hono routes mounted at `/api`.
 */
export function createWaitlistRoutes(deps: {
  clientIpConfig: ClientIpConfig;
  clock: Clock;
  db: AppDatabase;
}) {
  const { clientIpConfig, clock, db } = deps;

  const routes = new Hono();

  routes.post("/waitlist", validJson(waitlistSubmitSchema), (context) => {
    const body = context.req.valid("json");

    if (honeypotFilled(body)) {
      return context.json(waitlistConfirmation, 200);
    }

    const clientKey = clientIp(context.req.raw, clientIpConfig) ?? SHARED_CLIENT_KEY;

    if (!consumeRateLimit(db, `api.waitlist:${clientKey}`, clock.now(), WAITLIST_RATE_LIMIT)) {
      context.header("Retry-After", "3600");

      return context.json(waitlistRateLimited, 429);
    }

    recordWaitlistEntry(db, clock, {
      email: body.email,
      targetRole: body.targetRole,
      targetLocation: body.targetLocation,
    });

    return context.json(waitlistConfirmation, 200);
  });

  return routes;
}
