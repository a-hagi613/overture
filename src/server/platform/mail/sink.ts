import { randomUUID } from "node:crypto";

import { copy } from "../../../shared/copy.ts";
import { env } from "../../config/env.ts";
import type { Clock } from "../ports/clock.ts";

import type { MailSender, SentMail } from "./port.ts";

const captured: SentMail[] = [];
let failuresRemaining = 0;

export function failNextSinkMail(count = 1) {
  failuresRemaining = Math.max(0, count);
}

function failIfAsked() {
  if (failuresRemaining > 0) {
    failuresRemaining -= 1;

    throw new Error("sink mail failure requested by the test route");
  }
}

export function createSinkMailSender(clock: Clock) {
  const sender: MailSender = {
    sendMagicLink: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: copy.mail.magicLinkSubject,
        body: copy.mail.magicLinkBody(mail.url),
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendCheck: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: mail.subject,
        body: mail.body,
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendReadyRecap: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: mail.subject,
        body: mail.body,
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendAccountDeleted: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: copy.mail.accountDeletedSubject,
        body: copy.mail.accountDeletedBody(mail.name),
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendExportReady: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: mail.subject,
        body: mail.body,
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendBillingNotice: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: mail.subject,
        body: mail.body,
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendSupport: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: mail.subject,
        body: mail.body,
        replyTo: mail.replyTo,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
  };

  return sender;
}

export function listSinkMail() {
  const messages: SentMail[] = [...captured];

  return messages;
}

export function clearSinkMail() {
  captured.length = 0;
}
