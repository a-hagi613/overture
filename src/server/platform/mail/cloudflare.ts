import { Buffer } from "node:buffer";

import { z } from "zod";

import { copy } from "../../../shared/copy.ts";

import type { InboundCopyDelivery, MailSender, OutboundCopyAttachment } from "./port.ts";

const SEND_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY = 500;

const sendEmailResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).optional(),
  result: z
    .object({
      message_id: z.string().min(1),
      permanent_bounces: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
});

export interface CloudflareMailConfig {
  accountId: string;
  apiToken: string;
  baseUrl: string;
  from: string;
}

export function cloudflareSendEmailUrl(baseUrl: string, accountId: string) {
  return `${baseUrl.replace(/\/+$/u, "")}/accounts/${accountId}/email/sending/send`;
}

function failureDetail(body: z.infer<typeof sendEmailResponseSchema>) {
  const messages = (body.errors ?? []).map((error) => `${String(error.code)} ${error.message}`);

  return messages.length > 0 ? messages.join("; ") : "no error detail";
}

interface SendEmailOptions {
  headers?: Record<string, string>;
  attachments?: OutboundCopyAttachment[];
}

interface SendEmailPayload {
  attachments?: {
    content: string;
    disposition: "attachment" | "inline";
    filename: string;
    type: string;
  }[];
  from: string;
  headers?: Record<string, string>;
  reply_to?: string;
  subject: string;
  text: string;
  to: string[];
}

async function sendEmail(
  config: CloudflareMailConfig,
  to: string,
  subject: string,
  body: string,
  replyTo?: string,
  options: SendEmailOptions = {},
) {
  const payload: SendEmailPayload = {
    from: config.from,
    to: [to],
    subject: subject.replaceAll(/[\r\n]+/gu, " ").trim(),
    text: body,
  };

  if (replyTo !== undefined) {
    payload.reply_to = replyTo;
  }

  if (options.headers !== undefined) {
    payload.headers = options.headers;
  }

  if (options.attachments !== undefined && options.attachments.length > 0) {
    payload.attachments = options.attachments.map((attachment) => ({
      content: Buffer.from(attachment.content).toString("base64"),
      disposition: attachment.disposition,
      filename: attachment.filename,
      type: attachment.type,
    }));
  }

  const response = await fetch(cloudflareSendEmailUrl(config.baseUrl, config.accountId), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Cloudflare Email Sending failed with ${String(response.status)}: ${detail.slice(0, MAX_ERROR_BODY)}`,
    );
  }

  const parsed = sendEmailResponseSchema.parse(await response.json());

  if (!parsed.success || parsed.result === null || parsed.result === undefined) {
    throw new Error(`Cloudflare Email Sending failed: ${failureDetail(parsed)}`);
  }

  return {
    bounced: (parsed.result.permanent_bounces ?? []).some(
      (address) => address.trim().toLowerCase() === to.trim().toLowerCase(),
    ),
    messageId: parsed.result.message_id,
  } satisfies InboundCopyDelivery;
}

export function createCloudflareMailSender(config: CloudflareMailConfig) {
  const sender: MailSender = {
    sendMagicLink: async (mail) => {
      await sendEmail(
        config,
        mail.to,
        copy.mail.magicLinkSubject,
        copy.mail.magicLinkBody(mail.url),
      );
    },
    sendCheck: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body);
    },
    sendWaitlistInvite: async (mail) => {
      await sendEmail(
        config,
        mail.to,
        copy.mail.waitlistInviteSubject,
        copy.mail.waitlistInviteBody(mail.url),
      );
    },
    sendCodeWait: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body);
    },
    sendReadyRecap: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body);
    },
    sendAccountDeleted: async (mail) => {
      await sendEmail(
        config,
        mail.to,
        copy.mail.accountDeletedSubject,
        copy.mail.accountDeletedBody(mail.name),
      );
    },
    sendExportReady: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body);
    },
    sendBillingNotice: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body);
    },
    sendSupport: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body, mail.replyTo);
    },
    sendSupportReply: async (mail) => {
      await sendEmail(config, mail.to, mail.subject, mail.body);
    },
    sendInboundCopy: async (mail) => {
      const options: SendEmailOptions = {};

      if (mail.attachments !== undefined) {
        options.attachments = mail.attachments;
      }

      if (mail.headers !== undefined) {
        options.headers = mail.headers;
      }

      return sendEmail(config, mail.to, mail.subject, mail.text, mail.replyTo, options);
    },
  };

  return sender;
}
