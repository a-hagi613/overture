import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";
import { supportRequestEmail } from "../platform/mail/emails.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { validJson } from "./validators.ts";
import { readSessionUser } from "../auth/session.ts";
import { demoLocked } from "../demo/guard.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";
import { logError } from "../platform/log.ts";
import { supportTickets } from "../platform/db/schema.ts";
import { env } from "../config/env.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";
import { supportRequestSchema } from "../../shared/support.ts";

const SUPPORT_RATE_LIMIT = { max: 10, windowMs: 60 * 60_000 } as const;

function newReferenceId() {
  return `SUP-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

/**
 * The support form's one write: it records the request for the Admin Portal Support Queue and mails the support desk
 * with the sender as `Reply-To`. The message is sealed with the person's own key, the demo account is refused before
 * any work, and a mail failure answers `502` while the ticket stays recorded for the queue.
 * @param deps The database, clock, auth, mail sender and personal crypto the route reads through.
 * @returns The `/api/support` routes.
 */
export function createSupportRoutes(deps: {
  auth: Auth;
  clock: Clock;
  db: AppDatabase;
  mail: MailSender;
  personal: PersonalCrypto;
}) {
  const { auth, clock, db, mail, personal } = deps;

  const routes = new Hono();

  routes.post("/support", validJson(supportRequestSchema), async (context) => {
    context.header("Cache-Control", "private, no-store");

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(user.role);

    if (locked !== null) {
      return locked;
    }

    const allowed = consumeRateLimit(db, `api.support:${user.id}`, clock.now(), SUPPORT_RATE_LIMIT);

    if (!allowed) {
      return context.json({ error: API_ERRORS.rateLimited }, 429);
    }

    const request = context.req.valid("json");
    const id = randomUUID();
    const referenceId = newReferenceId();
    const now = new Date(clock.now());

    db.insert(supportTickets)
      .values({
        category: request.category,
        createdAt: now,
        id,
        messageEnc: await personal.sealFor(
          user.id,
          { column: "message_enc", rowId: id, table: "support_tickets" },
          request.message,
        ),
        referenceId,
        status: "open",
        subject: request.subject,
        updatedAt: now,
        userId: user.id,
      })
      .run();

    try {
      await mail.sendSupport({
        replyTo: user.email,
        to: env.SUPPORT_EMAIL,
        ...supportRequestEmail({
          category: request.category,
          email: user.email,
          message: request.message,
          name: user.name,
          referenceId,
          subject: request.subject,
        }),
      });
    } catch (error) {
      logError("support.mail", error);

      return context.json({ error: "mail_send_failed", referenceId }, 502);
    }

    return context.json({ ok: true, referenceId }, 201);
  });

  return routes;
}
