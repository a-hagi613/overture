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
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendEmailVerification: async (mail) => {
      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: copy.mail.verifyEmailSubject,
        body: copy.mail.verifyEmailBody(mail.url),
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendPasswordReset: async (mail) => {
      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: copy.mail.resetPasswordSubject,
        body: copy.mail.resetPasswordBody(mail.url),
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
