import { eq } from "drizzle-orm";

import type { AppDatabase } from "./db/client.ts";
import type { Clock } from "./ports/clock.ts";

import { env } from "../config/env.ts";
import { createNotification } from "../notify/notifications.ts";
import { users } from "./db/schema.ts";
import { publishEvent } from "./sse/stream.ts";

export const ALERT_KINDS = [
  "browser.proxy_trend",
  "dispatch.kill_switch",
  "llm.cap",
  "live.check.failure",
  "ats.success",
  "provider.success",
  "code.challenge_rate",
  "queue.age",
  "llm.spend",
  "backup.lag",
  "backup.failure",
  "catalog.worker",
  "health",
  "disk",
  "process.unhandled",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertDetail = Record<string, string | number | boolean | null>;

function notifyOwners(db: AppDatabase, clock: Clock, kind: AlertKind, detail: AlertDetail) {
  const owners = db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).all();
  const body = JSON.stringify(detail);

  for (const owner of owners) {
    createNotification(db, clock, {
      userId: owner.id,
      kind: "alert",
      title: `Overture alert: ${kind}`,
      body,
      url: "/",
    });
  }
}

async function pushToPhone(kind: AlertKind, detail: AlertDetail) {
  if (env.ALERT_NTFY_URL === undefined) {
    return;
  }

  await Promise.allSettled([
    fetch(env.ALERT_NTFY_URL, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        title: `Overture alert: ${kind}`,
        tags: "warning",
      },
      body: JSON.stringify(detail),
    }),
  ]);
}

export function raiseAlert(db: AppDatabase, clock: Clock, kind: AlertKind, detail: AlertDetail) {
  publishEvent(db, clock, "alert.raised", JSON.stringify({ kind, detail }));
  notifyOwners(db, clock, kind, detail);
  void pushToPhone(kind, detail);
}
