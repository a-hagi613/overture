import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { EmailSendingConfig } from "./sending-domain.ts";

import { createCloudflareMailSender } from "./cloudflare.ts";
import { createMeteredMailSender } from "./metered.ts";
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

function createAdapter(clock: Clock) {
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  if (apiToken !== undefined && accountId !== undefined) {
    return createCloudflareMailSender({
      accountId,
      apiToken,
      baseUrl: env.CLOUDFLARE_EMAIL_API_BASE_URL,
      from: env.MAIL_FROM,
    });
  }

  return createSinkMailSender(clock);
}

/**
 * The mail sender every path uses: the Cloudflare adapter when it is
 * configured, the sink otherwise, wrapped in the monthly counter that fails
 * closed at the Email Sending allowance (ADR 0033).
 * @param db The application database the counter uses.
 * @param clock The clock the month is read from.
 * @returns A sender that never exceeds the month's send budget.
 */
export function createMailSender(db: AppDatabase, clock: Clock) {
  return createMeteredMailSender(db, clock, createAdapter(clock));
}
