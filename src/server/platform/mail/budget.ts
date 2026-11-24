import { eq } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { activeSubscriberCount, scaledBudget, settingInteger, settingRatio } from "../budgets.ts";
import { mailUsage } from "../db/schema.ts";
import type { SETTING_DEFAULTS } from "../settings/index.ts";

/**
 * Cloudflare Email Sending includes 3,000 emails a month and bills $0.35 per
 * 1,000 after that. No native limit covers it (ADR 0033), so the app counts
 * every send in SQLite and stops itself below the allowance.
 */
export const MAIL_MONTHLY_CAP_KEY = "mail.monthly_cap" satisfies keyof typeof SETTING_DEFAULTS;

export const MAIL_PER_SUBSCRIBER_CAP_KEY =
  "mail.cap_per_subscriber" satisfies keyof typeof SETTING_DEFAULTS;

export const MAIL_WARNING_SHARE_KEY = "mail.warning_share" satisfies keyof typeof SETTING_DEFAULTS;

export const MAIL_SIGN_IN_RESERVE_KEY =
  "mail.sign_in_reserve" satisfies keyof typeof SETTING_DEFAULTS;

export const DEFAULT_MAIL_MONTHLY_CAP = 2700;

/**
 * One paying subscriber can ask for a Month plan's Applications in notices, so
 * the month's cap grows by one Month allowance each, on top of the base
 * (issue #564). Overage above the 3,000 included sends costs $0.35 per 1,000.
 */
export const DEFAULT_MAIL_PER_SUBSCRIBER_CAP = 250;
export const DEFAULT_MAIL_SIGN_IN_RESERVE = 270;

/** The owner hears about the cap when the month reaches four fifths of it, unless the admin sets another share. */
export const DEFAULT_MAIL_WARNING_SHARE = 0.8;

/**
 * Sends that keep the account useful when the month is nearly spent, and the
 * sends that give way to them first.
 */
export type MailCategory = "auth" | "system" | "notice";

/**
 * `auth` and `system` may use the reserve; `notice` may not.
 * @param category The kind of mail.
 * @returns Whether that kind is kept out of the notice limit.
 */
export function isProtectedCategory(category: MailCategory) {
  return category === "auth" || category === "system";
}

export type MailRefusalReason = "monthly_cap" | "sign_in_reserve";

export interface MailUsage {
  month: string;
  auth: number;
  system: number;
  notice: number;
  total: number;
  warnedAt: number | null;
  /** When notices first stopped at the reserve; sign-in mail still went. */
  reserveRefusedAt: number | null;
  /** When every kind of mail first stopped at the monthly cap. */
  refusedAt: number | null;
}

export interface MailBudget {
  /** The cap with no paying subscribers. */
  baseCap: number;
  /** The share one paying subscriber adds. */
  perSubscriber: number;
  /** The paying subscribers counted when the cap was read. */
  subscribers: number;
  cap: number;
  reserve: number;
  /** The most the month may spend on notices, leaving the reserve untouched. */
  noticeLimit: number;
  warningAt: number;
  /** The share of the cap at which the owner is warned. */
  warningShare: number;
}

export interface MailSendDecision {
  reason: MailRefusalReason | null;
  budget: MailBudget;
  usage: MailUsage;
  /** True on the one send that first crosses the warning threshold this month. */
  warningRaised: boolean;
  /**
   * True on the first notice refused at the reserve this month. It is its own
   * alert so that it never hides the refusal that stops every kind at the cap.
   */
  firstReserveRefusal: boolean;
  /** True on the first send of any kind refused at the monthly cap this month. */
  firstCapRefusal: boolean;
}

/**
 * The UTC calendar month the counter belongs to, such as `2026-11`.
 * @param atMs The instant to read the month from.
 * @returns The month key.
 */
export function monthKey(atMs: number) {
  const date = new Date(atMs);

  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The month's mail budget at one instant: the base, one Month plan's
 * allowance for every paying subscriber, and the sign-in reserve kept back
 * (issue #564). It grows from `period` grants only, which a paid Stripe
 * invoice issues, so subscriber growth can never silently stop the notices
 * paid Applications need.
 * @param db The application database.
 * @param atMs The instant to count paying subscribers at.
 * @returns The effective cap and how it was reached.
 */
export function mailBudget(db: Pick<AppDatabase, "select">, atMs: number) {
  const baseCap = settingInteger(db, MAIL_MONTHLY_CAP_KEY, {
    fallback: DEFAULT_MAIL_MONTHLY_CAP,
  });

  const perSubscriber = settingInteger(db, MAIL_PER_SUBSCRIBER_CAP_KEY, {
    fallback: DEFAULT_MAIL_PER_SUBSCRIBER_CAP,
  });

  const subscribers = activeSubscriberCount(db, atMs);
  const cap = scaledBudget(baseCap, perSubscriber, subscribers);

  const reserve = Math.min(
    settingInteger(db, MAIL_SIGN_IN_RESERVE_KEY, { fallback: DEFAULT_MAIL_SIGN_IN_RESERVE }),
    cap,
  );

  const warningShare = settingRatio(db, MAIL_WARNING_SHARE_KEY, DEFAULT_MAIL_WARNING_SHARE);

  return {
    baseCap,
    cap,
    noticeLimit: cap - reserve,
    perSubscriber,
    reserve,
    subscribers,
    warningAt: Math.ceil(cap * warningShare),
    warningShare,
  };
}

export function readMailUsage(db: Pick<AppDatabase, "select">, month: string) {
  const row = db.select().from(mailUsage).where(eq(mailUsage.month, month)).get();
  const auth = row?.authSends ?? 0;
  const system = row?.systemSends ?? 0;
  const notice = row?.noticeSends ?? 0;

  return {
    month,
    auth,
    system,
    notice,
    total: auth + system + notice,
    warnedAt: row?.warnedAt ?? null,
    reserveRefusedAt: row?.reserveRefusedAt ?? null,
    refusedAt: row?.refusedAt ?? null,
  };
}

/**
 * The month's counter and budget, plus whether each stop is in force *now*.
 * The stored stamps record the first refusal of the month; a cap raised by a
 * new paying subscriber lifts the stop, so the overview reads the live counts
 * against the current budget rather than the stamps.
 * @param db The application database.
 * @param atMs The instant to read the month and the budget at.
 * @returns The usage, the budget and the two live stop flags.
 */
export function readMailSummary(db: Pick<AppDatabase, "select">, atMs: number) {
  const usage = readMailUsage(db, monthKey(atMs));
  const budget = mailBudget(db, atMs);

  return {
    ...usage,
    ...budget,
    capReached: usage.total >= budget.cap,
    reserveReached: usage.total >= budget.noticeLimit && usage.total < budget.cap,
  };
}

function limitReason(budget: MailBudget, usage: MailUsage, category: MailCategory) {
  if (usage.total >= budget.cap) {
    return "monthly_cap" as const;
  }

  if (!isProtectedCategory(category) && usage.total >= budget.noticeLimit) {
    return "sign_in_reserve" as const;
  }

  return null;
}

/**
 * Counts one send and says whether it may go. The count happens before the
 * request leaves the machine, so a request that fails still counts and a
 * refused send never reaches Cloudflare. The month stops at the cap; notices
 * also stop at the reserve, which keeps magic links and the live check going.
 * Each stop is stamped once, in its own column, so the reserve alert does not
 * hide the cap alert when sign-in mail finally breaks. Settings and usage are
 * read inside one transaction, so both come from the same SQLite snapshot and a
 * cap changed mid-send cannot be mixed with a count taken under the old one.
 * @param db The application database.
 * @param clock The clock the month is read from.
 * @param category The kind of mail about to be sent.
 * @returns The decision, with the count after it, and the alerts it owes.
 */
export function reserveMailSend(db: AppDatabase, clock: Clock, category: MailCategory) {
  const now = clock.now();
  const month = monthKey(now);

  return db.transaction(
    (tx) => {
      const budget = mailBudget(tx, now);
      const current = readMailUsage(tx, month);
      const reason = limitReason(budget, current, category);

      if (reason !== null) {
        const firstReserveRefusal =
          reason === "sign_in_reserve" && current.reserveRefusedAt === null;

        const firstCapRefusal = reason === "monthly_cap" && current.refusedAt === null;

        const usage = {
          ...current,
          reserveRefusedAt: firstReserveRefusal ? now : current.reserveRefusedAt,
          refusedAt: firstCapRefusal ? now : current.refusedAt,
        };

        if (firstReserveRefusal || firstCapRefusal) {
          tx.insert(mailUsage)
            .values({
              month,
              refusedAt: usage.refusedAt,
              reserveRefusedAt: usage.reserveRefusedAt,
            })
            .onConflictDoUpdate({
              set: { refusedAt: usage.refusedAt, reserveRefusedAt: usage.reserveRefusedAt },
              target: mailUsage.month,
            })
            .run();
        }

        return {
          reason,
          budget,
          usage,
          warningRaised: false,
          firstReserveRefusal,
          firstCapRefusal,
        } satisfies MailSendDecision;
      }

      const next = {
        ...current,
        auth: current.auth + (category === "auth" ? 1 : 0),
        system: current.system + (category === "system" ? 1 : 0),
        notice: current.notice + (category === "notice" ? 1 : 0),
        total: current.total + 1,
      };

      const warningRaised = next.total >= budget.warningAt && current.warnedAt === null;

      tx.insert(mailUsage)
        .values({
          authSends: next.auth,
          month,
          noticeSends: next.notice,
          systemSends: next.system,
          warnedAt: warningRaised ? now : current.warnedAt,
        })
        .onConflictDoUpdate({
          set: {
            authSends: next.auth,
            noticeSends: next.notice,
            systemSends: next.system,
            warnedAt: warningRaised ? now : current.warnedAt,
          },
          target: mailUsage.month,
        })
        .run();

      return {
        reason: null,
        budget,
        usage: { ...next, warnedAt: warningRaised ? now : current.warnedAt },
        warningRaised,
        firstReserveRefusal: false,
        firstCapRefusal: false,
      } satisfies MailSendDecision;
    },
    { behavior: "immediate" },
  );
}
