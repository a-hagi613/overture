import type { Clock } from "../ports/clock.ts";

import type { MailSender } from "./port.ts";
import { createCloudflareMailSender } from "./cloudflare.ts";
import { createSinkMailSender } from "./sink.ts";
import { env } from "../../config/env.ts";

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
