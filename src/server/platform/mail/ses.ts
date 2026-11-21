import { z } from "zod";

import { copy } from "../../../shared/copy.ts";
import type { Clock } from "../ports/clock.ts";

import type { MailSender } from "./port.ts";
import { signSesPost } from "./sigv4.ts";

const SEND_TIMEOUT_MS = 30_000;
const SEND_PATH = "/v2/email/outbound-emails";
const MAX_ERROR_BODY = 500;

const sendEmailResponseSchema = z.object({ MessageId: z.string().min(1) });

interface SendEmailContent {
  Simple: {
    Subject: { Data: string; Charset: string };
    Body: { Text: { Data: string; Charset: string } };
  };
}

interface SendEmailPayload {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  Content: SendEmailContent;
  ConfigurationSetName?: string;
}

export interface SesMailConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  configurationSet: string | undefined;
  from: string;
}

export function sesSendEmailUrl(region: string) {
  return `https://email.${region}.amazonaws.com${SEND_PATH}`;
}

function payloadFor(config: SesMailConfig, to: string, subject: string, body: string) {
  const payload: SendEmailPayload = {
    FromEmailAddress: config.from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "utf8" },
        Body: { Text: { Data: body, Charset: "utf8" } },
      },
    },
  };

  if (config.configurationSet !== undefined) {
    payload.ConfigurationSetName = config.configurationSet;
  }

  return JSON.stringify(payload);
}

async function sendEmail(
  clock: Clock,
  config: SesMailConfig,
  to: string,
  subject: string,
  body: string,
) {
  const url = sesSendEmailUrl(config.region);
  const { host } = new URL(url);
  const payload = payloadFor(config, to, subject, body);

  const headers = signSesPost({
    host,
    path: SEND_PATH,
    body: payload,
    region: config.region,
    now: clock.now(),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: payload,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `SES SendEmail failed with ${String(response.status)}: ${detail.slice(0, MAX_ERROR_BODY)}`,
    );
  }

  sendEmailResponseSchema.parse(await response.json());
}

export function createSesMailSender(clock: Clock, config: SesMailConfig) {
  const sender: MailSender = {
    sendMagicLink: async (mail) => {
      await sendEmail(
        clock,
        config,
        mail.to,
        copy.mail.magicLinkSubject,
        copy.mail.magicLinkBody(mail.url),
      );
    },
    sendCheck: async (mail) => {
      await sendEmail(clock, config, mail.to, mail.subject, mail.body);
    },
  };

  return sender;
}
