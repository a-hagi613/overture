import type { Clock } from "../ports/clock.ts";

import type { MailSender } from "./port.ts";
import { createSesMailSender } from "./ses.ts";
import { createSinkMailSender } from "./sink.ts";
import { env } from "../../config/env.ts";

export function createMailSender(clock: Clock) {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_REGION;

  if (accessKeyId !== undefined && secretAccessKey !== undefined && region !== undefined) {
    const sender: MailSender = createSesMailSender(clock, {
      accessKeyId,
      secretAccessKey,
      region,
      configurationSet: env.SES_CONFIGURATION_SET,
      from: env.MAIL_FROM,
    });

    return sender;
  }

  const sender: MailSender = createSinkMailSender(clock);

  return sender;
}
