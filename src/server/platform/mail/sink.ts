import { randomUUID } from "node:crypto";

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
  function record(input: {
    attachments?: { bytes: number; filename: string; type: string }[];
    body: string;
    headers?: Record<string, string>;
    html: string;
    replyTo?: string;
    subject: string;
    to: string;
  }) {
    const sent: SentMail = {
      body: input.body,
      from: env.MAIL_FROM,
      html: input.html,
      id: randomUUID(),
      replyTo: input.replyTo ?? null,
      sentAt: clock.now(),
      subject: input.subject,
      to: input.to,
    };

    if (input.attachments !== undefined) {
      sent.attachments = input.attachments;
    }

    if (input.headers !== undefined) {
      sent.headers = input.headers;
    }

    captured.push(sent);

    return sent;
  }

  const sender: MailSender = {
    sendMagicLink: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendCheck: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendWaitlistInvite: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendCodeWait: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendReadyRecap: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendAccountDeleted: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendExportReady: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendBillingNotice: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendSupport: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendSupportReply: async (mail) => {
      failIfAsked();
      record(mail);
      await Promise.resolve();
    },
    sendInboundCopy: async (mail) => {
      failIfAsked();

      const bounced = nextBounce();
      const input: Parameters<typeof record>[0] = {
        attachments: (mail.attachments ?? []).map((attachment) => ({
          bytes: attachment.content.byteLength,
          filename: attachment.filename,
          type: attachment.type,
        })),
        body: mail.body,
        html: mail.html,
        subject: mail.subject,
        to: mail.to,
      };

      if (mail.headers !== undefined) {
        input.headers = mail.headers;
      }

      if (mail.replyTo !== undefined) {
        input.replyTo = mail.replyTo;
      }

      const sent = record(input);

      await Promise.resolve();

      return { bounced, messageId: sent.id };
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
