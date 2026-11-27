import { Buffer } from "node:buffer";

import { z } from "zod";

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

interface SendEmailInput {
  attachments?: OutboundCopyAttachment[];
  body: string;
  headers?: Record<string, string>;
  html: string;
  replyTo?: string;
  subject: string;
  to: string;
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
  html: string;
  reply_to?: string;
  subject: string;
  text: string;
  to: string[];
}

async function sendEmail(config: CloudflareMailConfig, input: SendEmailInput) {
  const payload: SendEmailPayload = {
    from: config.from,
    html: input.html,
    subject: input.subject.replaceAll(/[\r\n]+/gu, " ").trim(),
    text: input.body,
    to: [input.to],
  };

  if (input.replyTo !== undefined) {
    payload.reply_to = input.replyTo;
  }

  if (input.headers !== undefined) {
    payload.headers = input.headers;
  }

  if (input.attachments !== undefined && input.attachments.length > 0) {
    payload.attachments = input.attachments.map((attachment) => ({
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
      (address) => address.trim().toLowerCase() === input.to.trim().toLowerCase(),
    ),
    messageId: parsed.result.message_id,
  } satisfies InboundCopyDelivery;
}

export function createCloudflareMailSender(config: CloudflareMailConfig) {
  const sender: MailSender = {
    sendMagicLink: async (mail) => {
      await sendEmail(config, mail);
    },
    sendCheck: async (mail) => {
      await sendEmail(config, mail);
    },
    sendWaitlistInvite: async (mail) => {
      await sendEmail(config, mail);
    },
    sendCodeWait: async (mail) => {
      await sendEmail(config, mail);
    },
    sendReadyRecap: async (mail) => {
      await sendEmail(config, mail);
    },
    sendAccountDeleted: async (mail) => {
      await sendEmail(config, mail);
    },
    sendExportReady: async (mail) => {
      await sendEmail(config, mail);
    },
    sendBillingNotice: async (mail) => {
      await sendEmail(config, mail);
    },
    sendSupport: async (mail) => {
      await sendEmail(config, mail);
    },
    sendSupportReply: async (mail) => {
      await sendEmail(config, mail);
    },
    sendInboundCopy: async (mail) => {
      const input: SendEmailInput = {
        body: mail.body,
        html: mail.html,
        subject: mail.subject,
        to: mail.to,
      };

      if (mail.attachments !== undefined) {
        input.attachments = mail.attachments;
      }

      if (mail.headers !== undefined) {
        input.headers = mail.headers;
      }

      if (mail.replyTo !== undefined) {
        input.replyTo = mail.replyTo;
      }

      return sendEmail(config, input);
    },
  };

  return sender;
}
