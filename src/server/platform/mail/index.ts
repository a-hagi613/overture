import type { Clock } from "../ports/clock.ts";

import type { MailSender } from "./port.ts";
import { createSinkMailSender } from "./sink.ts";

export function createMailSender(clock: Clock) {
  const sender: MailSender = createSinkMailSender(clock);

  return sender;
}
