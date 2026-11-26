import { randomUUID } from "node:crypto";

import { copy } from "../../../shared/copy.ts";
import { env } from "../../config/env.ts";
import type { Clock } from "../ports/clock.ts";

import type { MailSender, SentMail } from "./port.ts";

const captured: SentMail[] = [];
let failuresRemaining = 0;
let bouncesRemaining = 0;

export function failNextSinkMail(count = 1) {
  failuresRemaining = Math.max(0, count);
}

/**
 * Make the next sends report a permanent bounce, so the Inbox's bounce surfacing can be tested.
 * @param count How many copies report a bounce.
 */
export function bounceNextSinkMail(count = 1) {
  bouncesRemaining = Math.max(0, count);
}

function failIfAsked() {
  if (failuresRemaining > 0) {
    failuresRemaining -= 1;

    throw new Error("sink mail failure requested by the test route");
  }
}

function nextBounce() {
  if (bouncesRemaining > 0) {
    bouncesRemaining -= 1;

    return true;
  }

  return false;
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
    sendWaitlistInvite: async (mail) => {
      failIfAsked();

      const sent = {
        id: randomUUID(),
        to: mail.to,
        from: env.MAIL_FROM,
        subject: copy.mail.waitlistInviteSubject,
        body: copy.mail.waitlistInviteBody(mail.url),
        replyTo: null,
        sentAt: clock.now(),
      };

      captured.push(sent);

      await Promise.resolve();
    },
    sendCodeWait: async (mail) => {
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
    sendSupportReply: async (mail) => {
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
    sendInboundCopy: async (mail) => {
      failIfAsked();

      const id = randomUUID();
      const bounced = nextBounce();

      const sent: SentMail = {
        attachments: (mail.attachments ?? []).map((attachment) => ({
          bytes: attachment.content.byteLength,
          filename: attachment.filename,
          type: attachment.type,
        })),
        body: mail.text,
        from: env.MAIL_FROM,
        id,
        replyTo: mail.replyTo ?? null,
        sentAt: clock.now(),
        subject: mail.subject,
        to: mail.to,
      };

      if (mail.headers !== undefined) {
        sent.headers = mail.headers;
      }

      captured.push(sent);

      await Promise.resolve();

      return { bounced, messageId: id };
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
