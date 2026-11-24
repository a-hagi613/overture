import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { CODE_WAIT_TIMEOUT_MS } from "../../shared/code-wait.ts";
import { copy } from "../../shared/copy.ts";
import { isDemoRole } from "../../shared/demo.ts";
import { MailCapExceededError } from "../platform/mail/errors.ts";
import { notifications, users } from "../platform/db/schema.ts";
import { logInfo } from "../platform/log.ts";
import { hasActivePushEndpoint } from "./push.ts";

export interface CodeWaitEmailDeps {
  db: AppDatabase;
  clock: Clock;
  mail: MailSender;
  appOrigin: string;
}

export interface CodeWaitEmailInput {
  userId: string;
  /** The alert row this email stands in for; its `emailed_at` is the idempotency marker. */
  notificationId: string;
}

const inFlight = new Map<string, Promise<{ sent: boolean }>>();

/**
 * Email the code-paste ask when the user has no push endpoint left to reach
 * (#565). One email per alert row: `notifications.emailed_at` is stamped, so a
 * second call for the same wait sends nothing. A user with a live push endpoint
 * (rows are pruned on 404/410 by the push job) is never emailed, so calling
 * this again after a delivery attempt is safe.
 * @param deps The database, clock, mail sender and public app origin.
 * @param input The user and the alert row.
 * @returns Whether an email left the machine.
 */
export async function sendCodeWaitEmailFallback(
  deps: CodeWaitEmailDeps,
  input: CodeWaitEmailInput,
) {
  const running = inFlight.get(input.notificationId);

  if (running !== undefined) {
    await running;
  }

  const delivery = runCodeWaitEmail(deps, input);

  inFlight.set(input.notificationId, delivery);

  return await delivery;
}

async function runCodeWaitEmail(deps: CodeWaitEmailDeps, input: CodeWaitEmailInput) {
  try {
    return await deliverCodeWaitEmail(deps, input);
  } finally {
    inFlight.delete(input.notificationId);
  }
}

async function deliverCodeWaitEmail(deps: CodeWaitEmailDeps, input: CodeWaitEmailInput) {
  if (hasActivePushEndpoint(deps.db, input.userId)) {
    return { sent: false };
  }

  const notification = deps.db
    .select({
      emailedAt: notifications.emailedAt,
      kind: notifications.kind,
      title: notifications.title,
      url: notifications.url,
    })
    .from(notifications)
    .where(eq(notifications.id, input.notificationId))
    .get();

  if (
    notification === undefined ||
    notification.emailedAt !== null ||
    notification.kind !== "code_wait"
  ) {
    return { sent: false };
  }

  const to = deps.db
    .select({ email: users.email, role: users.role, verified: users.emailVerified })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();

  if (to === undefined || !to.verified || isDemoRole(to.role)) {
    return { sent: false };
  }

  try {
    await deps.mail.sendCodeWait({
      body: copy.mail.codeWaitBody({
        minutes: CODE_WAIT_TIMEOUT_MS / 60_000,
        url: `${deps.appOrigin.replace(/\/+$/u, "")}${notification.url}`,
      }),
      subject: notification.title,
      to: to.email,
    });
  } catch (error) {
    if (!(error instanceof MailCapExceededError)) {
      throw error;
    }

    logInfo("code_wait.email", `fallback email refused: ${error.message}`);

    return { sent: false };
  }

  deps.db
    .update(notifications)
    .set({ emailedAt: new Date(deps.clock.now()) })
    .where(eq(notifications.id, input.notificationId))
    .run();

  logInfo("code_wait.email", `emailed the paste ask for notification ${input.notificationId}`);

  return { sent: true };
}
