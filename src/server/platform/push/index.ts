import type { Env } from "../../config/env.ts";
import type { Clock } from "../ports/clock.ts";
import type { PushSender } from "../ports/push.ts";

import { createWebPushSender } from "./web-push.ts";

export function createPushSender(env: Env, clock: Clock) {
  if (env.VAPID_PUBLIC_KEY === undefined || env.VAPID_PRIVATE_KEY === undefined) {
    return null;
  }

  const sender: PushSender = createWebPushSender(
    {
      privateKey: env.VAPID_PRIVATE_KEY,
      publicKey: env.VAPID_PUBLIC_KEY,
      subject: env.VAPID_SUBJECT,
    },
    clock,
  );

  return sender;
}
