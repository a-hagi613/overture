import type { AppDatabase } from "../platform/db/client.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { isDemoUserEmail } from "./role.ts";

/**
 * Wrap a mail sender so nothing is ever sent to the demo account, whatever
 * asked for it (a magic link, a recap, a live check). The demo signs in by
 * one click and never receives mail (#278).
 * @param db The application database, read for the recipient's role.
 * @param sender The real mail sender.
 * @returns A mail sender that drops every demo recipient.
 */
export function createDemoSafeMailSender(db: AppDatabase, sender: MailSender) {
  const allowed = (to: string) => !isDemoUserEmail(db, to);

  const guarded: MailSender = {
    sendCheck: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendCheck(mail);
      }
    },
    sendEmailVerification: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendEmailVerification(mail);
      }
    },
    sendMagicLink: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendMagicLink(mail);
      }
    },
    sendPasswordReset: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendPasswordReset(mail);
      }
    },
    sendAccountDeleted: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendAccountDeleted(mail);
      }
    },
    sendExportReady: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendExportReady(mail);
      }
    },
    sendReadyRecap: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendReadyRecap(mail);
      }
    },
    sendBillingNotice: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendBillingNotice(mail);
      }
    },
  };

  return guarded;
}
