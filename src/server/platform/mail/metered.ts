import type { MailCategory, MailRefusalReason, MailUsage } from "./budget.ts";
import type { MailSender } from "./port.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { raiseAlert } from "../alerts.ts";
import { isProtectedCategory, reserveMailSend } from "./budget.ts";

/**
 * Thrown when the month's Email Sending allowance refuses a send. Callers that
 * can wait for the next month treat it as nothing to send; sign-in mail and the
 * live check let it surface so nothing claims a mail that was never sent.
 */
export class MailCapExceededError extends Error {
  constructor(category: MailCategory, reason: MailRefusalReason, usage: MailUsage) {
    super(
      `Email Sending refused a ${category} mail for ${usage.month}: ${String(usage.total)} of the month is spent (${reason})`,
    );
    this.name = "MailCapExceededError";
  }
}

/**
 * Wraps a mail sender so every send is counted before it leaves the machine and
 * the month fails closed at its cap (ADR 0033). The owner is alerted once at
 * 80% and once at the first refusal.
 * @param db The application database.
 * @param clock The clock the month is read from.
 * @param adapter The adapter that actually sends.
 * @returns A sender with the same surface that never exceeds the month's cap.
 */
export function createMeteredMailSender(db: AppDatabase, clock: Clock, adapter: MailSender) {
  async function metered(category: MailCategory, send: () => Promise<void>) {
    const decision = reserveMailSend(db, clock, category);

    const detail = {
      cap: decision.budget.cap,
      category,
      noticeLimit: decision.budget.noticeLimit,
      protected: isProtectedCategory(category),
      month: decision.usage.month,
      reserve: decision.budget.reserve,
      sent: decision.usage.total,
    };

    if (decision.warningRaised) {
      raiseAlert(db, clock, "mail.cap", { ...detail, stage: "warning" });
    }

    if (decision.firstRefusal) {
      raiseAlert(db, clock, "mail.cap", {
        ...detail,
        reason: decision.reason,
        stage: "refused",
      });
    }

    if (decision.reason !== null) {
      throw new MailCapExceededError(category, decision.reason, decision.usage);
    }

    await send();
  }

  const sender: MailSender = {
    sendMagicLink: async (mail) => {
      await metered("auth", async () => adapter.sendMagicLink(mail));
    },
    sendEmailVerification: async (mail) => {
      await metered("auth", async () => adapter.sendEmailVerification(mail));
    },
    sendPasswordReset: async (mail) => {
      await metered("auth", async () => adapter.sendPasswordReset(mail));
    },
    sendCheck: async (mail) => {
      await metered("system", async () => adapter.sendCheck(mail));
    },
    sendReadyRecap: async (mail) => {
      await metered("notice", async () => adapter.sendReadyRecap(mail));
    },
  };

  return sender;
}
