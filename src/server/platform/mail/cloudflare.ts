import { z } from "zod";

import { copy } from "../../../shared/copy.ts";

import type { MailSender } from "./port.ts";

const SEND_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY = 500;

const sendEmailResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).optional(),
  result: z
    .object({ message_id: z.string().min(1) })
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

async function sendEmail(
  config: CloudflareMailConfig,
  to: string,
  subject: string,
  body: string,
  replyTo?: string,
) {
  const base = {
    from: config.from,
    to: [to],
    subject,
    text: body,
  };

  const payload = replyTo === undefined ? base : { ...base, reply_to: replyTo };

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
  };

  return sender;
}
