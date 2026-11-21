import { randomUUID } from "node:crypto";

import { copy } from "../../../shared/copy.ts";
import { env } from "../../config/env.ts";
import type { Clock } from "../ports/clock.ts";

import type { MailSender, SentMail } from "./port.ts";

const captured: SentMail[] = [];

export function createSinkMailSender(clock: Clock) {
  const sender: MailSender = {
    sendMagicLink: async (mail) => {
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
    sendCheck: async (mail) => {
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
