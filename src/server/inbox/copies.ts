import { eq } from "drizzle-orm";

import type { ParsedMail } from "mailparser";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { mailDeliveries, mailboxes, users } from "../platform/db/schema.ts";
import { RetryLaterError } from "../platform/jobs/retry.ts";
import { copyLoopReason, inboundCopyOf } from "./forward.ts";

/** A copy is retried a few times for a temporary provider failure, then left failed and surfaced. */
export const MAIL_COPY_MAX_ATTEMPTS = 5;

export type CopyDeliveryStatus = "pending" | "sent" | "failed" | "bounced" | "skipped";

export interface CopyDeliveryRow {
  attempts: number;
  id: string;
  status: CopyDeliveryStatus;
}

function deliveryOf(db: AppDatabase, messageId: string) {
  return db
    .select({
      attempts: mailDeliveries.attempts,
      id: mailDeliveries.id,
      status: mailDeliveries.status,
    })
    .from(mailDeliveries)
    .where(eq(mailDeliveries.messageId, messageId))
    .get();
}

/**
 * Sends the one copy of a stored inbound Message to the account's current verified login email
 * (issue #693). It reads the address at send time, so a changed sign-in email routes to the new
 * address, and it never sends to a shared or owner destination.
 *
 * A provider failure marks the delivery `failed` and raises {@link RetryLaterError} while attempts
 * remain, so the message job retries; the unique delivery row means a retry never makes a second
 * copy after a success. A loop or an unverified account marks it `skipped`.
 * @param deps The database, clock, mail sender, Overture origin and the domains that never loop.
 * @returns The copy sender and the delivery reader.
 */
export function createInboundCopies(deps: {
  clock: Clock;
  db: AppDatabase;
  /** The Overture domains that must never receive their own mail back. */
  domains: readonly string[];
  mail: MailSender;
  origin: string;
}) {
  const { clock, db, domains, mail, origin } = deps;

  function inboxUrl(messageId: string) {
    const url = new URL("/inbox", origin);

    url.searchParams.set("message", messageId);

    return url.toString();
  }

  function mark(
    messageId: string,
    status: CopyDeliveryStatus,
    detail: string | null,
    providerMessageId: string | null = null,
  ) {
    db.update(mailDeliveries)
      .set({
        detail,
        providerMessageId,
        status,
        updatedAt: new Date(clock.now()),
      })
      .where(eq(mailDeliveries.messageId, messageId))
      .run();

    return { detail, providerMessageId, status } as const;
  }

  async function deliver(input: {
    mailboxId: string;
    messageId: string;
    parsed: ParsedMail;
    rcptTo: string;
    userId: string;
  }) {
    const { mailboxId, messageId, parsed, rcptTo, userId } = input;
    const existing = deliveryOf(db, messageId);

    if (existing === undefined) {
      return "skipped";
    }

    if (existing.status === "sent" || existing.status === "bounced") {
      return existing.status;
    }

    const person = db
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    const mailbox = db
      .select({ status: mailboxes.status })
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId))
      .get();

    if (mailbox === undefined || mailbox.status === "closed") {
      return mark(messageId, "skipped", "mailbox_inactive").status;
    }

    if (person === undefined || !person.emailVerified || person.email.trim() === "") {
      return mark(messageId, "skipped", "unverified").status;
    }

    const loop = copyLoopReason(parsed, domains);

    if (loop !== null) {
      return mark(messageId, "skipped", loop).status;
    }

    const copy = inboundCopyOf({ inboxUrl: inboxUrl(messageId), parsed, rcptTo });

    const to = person.email.trim().toLowerCase();

    db.update(mailDeliveries)
      .set({ attempts: existing.attempts + 1, updatedAt: new Date(clock.now()) })
      .where(eq(mailDeliveries.messageId, messageId))
      .run();

    try {
      const sent = await mail.sendInboundCopy({ ...copy, to });

      if (sent.bounced) {
        return mark(messageId, "bounced", "permanent_bounce", sent.messageId).status;
      }

      return mark(messageId, "sent", null, sent.messageId).status;
    } catch {
      mark(messageId, "failed", "send_failed");

      if (existing.attempts + 1 < MAIL_COPY_MAX_ATTEMPTS) {
        throw new RetryLaterError("The inbound copy will be retried.", 30_000);
      }

      return "failed";
    }
  }

  return { deliver, deliveryOf };
}
