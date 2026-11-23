import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { Auth } from "../auth/index.ts";

import { supportRequestSchema, supportResponseSchema } from "../../shared/support.ts";
import type { SupportRequest } from "../../shared/support.ts";
import { consumeRateLimit } from "../auth/rate-limit.ts";

const HOUR_MS = 60 * 60_000;
const MAX_REQUESTS_PER_HOUR = 5;

interface SupportUser {
  id: string;
  name: string;
  email: string;
}

export interface SupportRouteDeps {
  auth: Auth;
  db: AppDatabase;
  clock: Clock;
  mail: MailSender;
  supportEmail: string;
}

async function readSession(auth: Auth, context: Context) {
  const session = await auth.api.getSession({ headers: context.req.raw.headers }).catch(() => null);

  return session?.user ?? null;
}

function composeSupportBody(user: SupportUser, request: SupportRequest, referenceId: string) {
  return [
    "A user sent a support message.",
    "",
    `Reference: ${referenceId}`,
    `User ID: ${user.id}`,
    `Name: ${user.name}`,
    `Email: ${user.email}`,
    `Category: ${request.category}`,
    `Subject: ${request.subject}`,
    "",
    request.message,
  ].join("\n");
}

export function createSupportRoutes(deps: SupportRouteDeps) {
  const { auth, clock, db, mail, supportEmail } = deps;

  const routes = new Hono();

  routes.post("/support", zValidator("json", supportRequestSchema), async (context) => {
    const user = await readSession(auth, context);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const allowed = consumeRateLimit(
      db,
      clock,
      `support:user:${user.id}`,
      HOUR_MS,
      MAX_REQUESTS_PER_HOUR,
    );

    if (!allowed) {
      return context.json({ error: "rate_limited" }, 429);
    }

    const request = context.req.valid("json");
    const subject = `[Overture Support - ${request.category}] ${request.subject.replaceAll(/\s+/gu, " ")}`;
    const referenceId = crypto.randomUUID();

    await mail.sendSupportMessage({
      to: supportEmail,
      subject,
      body: composeSupportBody(user, request, referenceId),
    });

    const response = supportResponseSchema.parse({
      ok: true,
      referenceId,
    });

    return context.json(response, 201);
  });

  return routes;
}
