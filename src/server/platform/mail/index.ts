import type { Clock } from "../ports/clock.ts";

import type { MailSender } from "./port.ts";
import type { EmailSendingConfig } from "./sending-domain.ts";
import { createCloudflareMailSender } from "./cloudflare.ts";
import { createSinkMailSender } from "./sink.ts";
import { env } from "../../config/env.ts";

export function emailSendingConfigFromEnv() {
  if (env.CLOUDFLARE_EMAIL_API_TOKEN === undefined || env.CLOUDFLARE_ACCOUNT_ID === undefined) {
    return null;
  }

  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    zoneId: env.CLOUDFLARE_ZONE_ID ?? null,
    apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN,
    baseUrl: env.CLOUDFLARE_EMAIL_API_BASE_URL,
    domain: env.MAIL_DOMAIN,
  } satisfies EmailSendingConfig;
}

export function createMailSender(clock: Clock) {
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  if (apiToken !== undefined && accountId !== undefined) {
    const sender: MailSender = createCloudflareMailSender({
      accountId,
      apiToken,
      baseUrl: env.CLOUDFLARE_EMAIL_API_BASE_URL,
      from: env.MAIL_FROM,
    });

    return sender;
  }

  const sender: MailSender = createSinkMailSender(clock);

  return sender;
}
