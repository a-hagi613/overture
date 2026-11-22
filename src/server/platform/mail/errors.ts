import type { MailCategory, MailRefusalReason, MailUsage } from "./budget.ts";

/**
 * Thrown when the month's Email Sending allowance refuses a send. Callers that
 * can wait for the next month treat it as nothing to send; sign-in mail and the
 * live check let it surface so nothing claims a mail that was never sent.
 */
export class MailCapExceededError extends Error {
  constructor(category: MailCategory, reason: MailRefusalReason, usage: MailUsage) {
    super(
      `Email Sending refused a ${category} mail for ${usage.month}: ${String(usage.total)} of the month is spent (${reason})`,
    );
    this.name = "MailCapExceededError";
  }
}
