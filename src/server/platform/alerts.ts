import { eq } from "drizzle-orm";

import type { AppDatabase } from "./db/client.ts";
import type { Clock } from "./ports/clock.ts";

import { env } from "../config/env.ts";
import { createNotification } from "../notify/notifications.ts";
import { users } from "./db/schema.ts";
import { logError } from "./log.ts";
import { publishEvent } from "./sse/stream.ts";

export const ALERT_KINDS = [
  "browser.minutes_trend",
  "browser.network_policy",
  "browser.proxy_trend",
  "dispatch.kill_switch",
  "mail.cap",
  "llm.cap",
  "live.check.failure",
  "mail.dead_letter",
  "mail.reply_rate",
  "mail.domain_reply_rate",
  "ats.success",
  "provider.success",
  "code.challenge_rate",
  "queue.age",
  "llm.spend",
  "application.confirming_stuck",
  "application.cost",
  "match.unscored",
  "mail.forwarding",
  "llm.schema_rejection",
  "backup.lag",
  "backup.failure",
  "billing.mismatch",
  "catalog.worker",
  "jobs.pull",
  "health",
  "disk",
  "process.unhandled",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertDetail = Record<string, string | number | boolean | null>;

function notifyOwners(
  db: AppDatabase,
  clock: Clock,
  owners: readonly { id: string }[],
  kind: AlertKind,
  detail: AlertDetail,
) {
  const body = JSON.stringify(detail);
  const payload = JSON.stringify({ kind, detail });

  for (const owner of owners) {
    publishEvent(db, clock, "alert.raised", payload, owner.id);

    createNotification(db, clock, {
      userId: owner.id,
      kind: "alert",
      title: `Overture alert: ${kind}`,
      body,
      url: "/home",
    });
  }
}

const ALERT_PUSH_TIMEOUT_MS = 10_000;

/**
 * Pushes one alert to the owner's phone. A hung ntfy connection must never wedge the caller or leak its socket, so the
 * request never follows a redirect and gives up after ten seconds; the response body is cancelled because only the
 * status matters. A refused or non-2xx push is logged so a broken alert path stays visible.
 * @param kind The alert kind, used as the push title.
 * @param detail The allowlisted detail, sent as the push body.
 * @param url The ntfy topic to post to; defaults to the configured `ALERT_NTFY_URL`, and no URL sends nothing.
 */
export async function pushToPhone(
  kind: AlertKind,
  detail: AlertDetail,
  url: string | undefined = env.ALERT_NTFY_URL,
) {
  if (url === undefined) {
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        title: `Overture alert: ${kind}`,
        tags: "warning",
      },
      body: JSON.stringify(detail),
      redirect: "manual",
      signal: AbortSignal.timeout(ALERT_PUSH_TIMEOUT_MS),
    });

    await response.body?.cancel();

    if (!response.ok) {
      logError(
        "alerts.push",
        new Error(`ntfy answered HTTP ${String(response.status)} for ${kind}`),
      );
    }
  } catch (error) {
    logError("alerts.push", error);
  }
}

export function raiseAlert(db: AppDatabase, clock: Clock, kind: AlertKind, detail: AlertDetail) {
  const owners = db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).all();

  notifyOwners(db, clock, owners, kind, detail);
  void pushToPhone(kind, detail);
}
