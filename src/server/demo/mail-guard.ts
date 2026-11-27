import type { AppDatabase } from "../platform/db/client.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { isDemoUserEmail } from "./role.ts";

/**
 * Wrap a mail sender so nothing is ever sent to the demo account, whatever
 * asked for it (a magic link, an export notice, a live check). The demo signs in by
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
    sendWaitlistInvite: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendWaitlistInvite(mail);
      }
    },
    sendCodeWait: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendCodeWait(mail);
      }
    },
    sendMagicLink: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendMagicLink(mail);
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
    sendBillingNotice: async (mail) => {
      if (allowed(mail.to)) {
        await sender.sendBillingNotice(mail);
      }
    },
    sendSupport: async (mail) => {
      await sender.sendSupport(mail);
    },
    sendSupportReply: async (mail) => {
      await sender.sendSupportReply(mail);
    },
    sendInboundCopy: async (mail) => {
      if (!allowed(mail.to)) {
        return { bounced: false, messageId: "demo-skipped" };
      }

      return sender.sendInboundCopy(mail);
    },
  };

  return guarded;
}
