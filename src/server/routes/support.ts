import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { Auth } from "../auth/index.ts";

import { API_ERRORS } from "../../shared/api-errors.ts";
import { supportRequestSchema, supportResponseSchema } from "../../shared/support.ts";
import type { SupportRequest } from "../../shared/support.ts";
import { consumeRateLimit } from "../auth/rate-limit.ts";
import { readSessionUser } from "../auth/session.ts";
import { demoLocked } from "../demo/guard.ts";
import { logError } from "../platform/log.ts";
import { validJson } from "./validators.ts";

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

  routes.post("/support", validJson(supportRequestSchema), async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(user.role);

    if (locked !== null) {
      return locked;
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

    try {
      await mail.sendSupportMessage({
        to: supportEmail,
        replyTo: user.email,
        subject,
        body: composeSupportBody(user, request, referenceId),
      });
    } catch (error) {
      logError("support.send", error);

      return context.json({ error: "mail_send_failed" }, 502);
    }

    const response = supportResponseSchema.parse({
      ok: true,
      referenceId,
    });

    return context.json(response, 201);
  });

  return routes;
}
