import type { MailCategory } from "./budget.ts";
import type { MailSender } from "./port.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { raiseAlert } from "../alerts.ts";
import { MailCapExceededError } from "./errors.ts";
import { isProtectedCategory, reserveMailSend } from "./budget.ts";

/**
 * Wraps a mail sender so every send is counted before it leaves the machine and
 * the month fails closed at its cap (ADR 0033). The owner is alerted once at
 * 80%, once when notices pause at the sign-in reserve, and once when every kind
 * of mail stops at the cap.
 * @param db The application database.
 * @param clock The clock the month is read from.
 * @param adapter The adapter that actually sends.
 * @returns A sender with the same surface that never exceeds the month's cap.
 */
export function createMeteredMailSender(db: AppDatabase, clock: Clock, adapter: MailSender) {
  async function metered(category: MailCategory, send: () => Promise<void>) {
    const decision = reserveMailSend(db, clock, category);

    const detail = {
      baseCap: decision.budget.baseCap,
      cap: decision.budget.cap,
      category,
      noticeLimit: decision.budget.noticeLimit,
      perSubscriber: decision.budget.perSubscriber,
      protected: isProtectedCategory(category),
      month: decision.usage.month,
      reserve: decision.budget.reserve,
      sent: decision.usage.total,
      subscribers: decision.budget.subscribers,
      warningAt: decision.budget.warningAt,
    };

    if (decision.warningRaised) {
      raiseAlert(db, clock, "mail.cap", { ...detail, stage: "warning" });
    }

    if (decision.firstReserveRefusal || decision.firstCapRefusal) {
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
    sendCheck: async (mail) => {
      await metered("system", async () => adapter.sendCheck(mail));
    },
    sendWaitlistInvite: async (mail) => {
      await metered("system", async () => adapter.sendWaitlistInvite(mail));
    },
    sendCodeWait: async (mail) => {
      await metered("system", async () => adapter.sendCodeWait(mail));
    },
    sendAccountDeleted: async (mail) => {
      await metered("system", async () => adapter.sendAccountDeleted(mail));
    },
    sendReadyRecap: async (mail) => {
      await metered("notice", async () => adapter.sendReadyRecap(mail));
    },
    sendExportReady: async (mail) => {
      await metered("notice", async () => adapter.sendExportReady(mail));
    },
    sendBillingNotice: async (mail) => {
      await metered("system", async () => adapter.sendBillingNotice(mail));
    },
    sendSupport: async (mail) => {
      await metered("system", async () => adapter.sendSupport(mail));
    },
    sendSupportReply: async (mail) => {
      await metered("system", async () => adapter.sendSupportReply(mail));
    },
  };

  return sender;
}
