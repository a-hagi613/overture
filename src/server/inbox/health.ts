import { and, count, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, killSwitches, mailThreads, messages } from "../platform/db/schema.ts";

export const MAIL_HEALTH_WINDOW_DAYS = 30;
export const MAIL_REPLY_MIN_SENDS = 10;
export const MAIL_DOMAIN_MIN_SENDS = 20;
export const MAIL_REPLY_FLOOR = 0.05;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MailHealthStatus = "healthy" | "reply_alert" | "too_few_sends" | "watch";

export interface MailAuthCounts {
  pass: number;
  fail: number;
  none: number;
}

export interface EmployerKillSwitch {
  enabled: boolean;
  reason: string;
}

export interface EmployerMailHealth {
  applications: number;
  ats: string[];
  auth: MailAuthCounts;
  bounces: number;
  companyId: string;
  employer: string;
  killSwitch: EmployerKillSwitch | null;
  replies: number;
  replyRate: number | null;
  sent: number;
  status: MailHealthStatus;
}

export interface MailHealthAlert {
  companyId: string;
  employer: string;
  replies: number;
  sent: number;
}

export interface MailHealthView {
  alerts: MailHealthAlert[];
  days: number;
  domainAlert: {
    active: boolean;
    replies: number;
    replyRate: number | null;
    sent: number;
  };
  employers: EmployerMailHealth[];
  since: number;
  totals: {
    auth: MailAuthCounts;
    bounces: number;
    replies: number;
    sent: number;
  };
}

export interface MailReplyCount {
  employer: string;
  key: string;
  replies: number;
  sent: number;
}

export interface MailReplyCounts {
  domain: { replies: number; sent: number };
  employers: MailReplyCount[];
}

function emptyAuth() {
  return { fail: 0, none: 0, pass: 0 };
}

function emptyMailTotals() {
  return { auth: emptyAuth(), bounces: 0, replies: 0 };
}

function replyRateOf(sent: number, replies: number) {
  return sent === 0 ? null : replies / sent;
}

function statusOf(sent: number, replies: number, bounces: number) {
  let status: MailHealthStatus = "healthy";

  if (sent === 0 || (replies === 0 && sent < MAIL_REPLY_MIN_SENDS)) {
    status = "too_few_sends";
  } else if (replies / sent < MAIL_REPLY_FLOOR) {
    status = "reply_alert";
  } else if (bounces > 0) {
    status = "watch";
  }

  return status;
}

const STATUS_RANK: Record<MailHealthStatus, number> = {
  healthy: 2,
  reply_alert: 0,
  too_few_sends: 3,
  watch: 1,
};

/**
 * The admin mail-health view: mail in and replies per employer, authentication results, and the
 * reply rate over Applications sent in the window. It reads counts only and never touches message
 * content. Bounces are outbound messages the transport returned (`out_status = 'bounced'`); no
 * path sends mail to an employer in M2, so the column stays at zero until one does.
 *
 * @param db the app database
 * @param clock the clock that fixes the window
 * @param days the window length in days
 * @returns the mail-health view for the window, and the alert state it implies
 */
export function readMailHealth(
  db: AppDatabase,
  clock: Clock,
  days: number = MAIL_HEALTH_WINDOW_DAYS,
) {
  const since = clock.now() - days * DAY_MS;
  const sinceDate = new Date(since);

  const sendRows = db
    .select({
      companyId: applications.companyId,
      employer: sql<string>`max(${applications.companyName})`,
      sent: count(applications.id),
    })
    .from(applications)
    .where(and(isNotNull(applications.sentAt), gte(applications.sentAt, since)))
    .groupBy(applications.companyId)
    .all();

  const applicationRows = db
    .select({ companyId: applications.companyId, total: count() })
    .from(applications)
    .where(gte(applications.createdAt, since))
    .groupBy(applications.companyId)
    .all();

  const atsRows = db
    .select({ ats: applications.ats, companyId: applications.companyId })
    .from(applications)
    .where(and(isNotNull(applications.sentAt), gte(applications.sentAt, since)))
    .groupBy(applications.companyId, applications.ats)
    .all();

  const mailRows = db
    .select({
      auth: messages.auth,
      companyId: applications.companyId,
      direction: messages.direction,
      outStatus: messages.outStatus,
      total: count(messages.id),
    })
    .from(messages)
    .innerJoin(mailThreads, eq(mailThreads.id, messages.threadId))
    .innerJoin(applications, eq(applications.id, mailThreads.applicationId))
    .where(gte(messages.createdAt, sinceDate))
    .groupBy(applications.companyId, messages.direction, messages.auth, messages.outStatus)
    .all();

  const authRows = db
    .select({ auth: messages.auth, total: count() })
    .from(messages)
    .where(and(eq(messages.direction, "in"), gte(messages.createdAt, sinceDate)))
    .groupBy(messages.auth)
    .all();

  const switchRows = db.select().from(killSwitches).where(eq(killSwitches.scope, "employer")).all();

  const names = new Map(sendRows.map((row) => [row.companyId, row.employer]));

  const sentByCompany = new Map(sendRows.map((row) => [row.companyId, row.sent]));
  const applicationsByCompany = new Map(applicationRows.map((row) => [row.companyId, row.total]));
  const atsByCompany = new Map<string, string[]>();

  const mailByCompany = new Map<
    string,
    { auth: MailAuthCounts; bounces: number; replies: number }
  >();

  for (const row of atsRows) {
    if (row.ats === null) {
      continue;
    }

    const values = atsByCompany.get(row.companyId) ?? [];

    if (!values.includes(row.ats)) {
      values.push(row.ats);
    }

    atsByCompany.set(row.companyId, values);
  }

  for (const row of mailRows) {
    const entry = mailByCompany.get(row.companyId) ?? emptyMailTotals();

    if (row.direction === "in") {
      entry.replies += row.total;

      if (row.auth === "pass") {
        entry.auth.pass += row.total;
      } else if (row.auth === "fail") {
        entry.auth.fail += row.total;
      } else {
        entry.auth.none += row.total;
      }
    } else if (row.outStatus === "bounced") {
      entry.bounces += row.total;
    }

    mailByCompany.set(row.companyId, entry);
  }

  const missingNames = [...mailByCompany.keys()].filter((companyId) => !names.has(companyId));

  if (missingNames.length > 0) {
    for (const row of db
      .select({
        companyId: applications.companyId,
        name: sql<string>`max(${applications.companyName})`,
      })
      .from(applications)
      .where(inArray(applications.companyId, missingNames))
      .groupBy(applications.companyId)
      .all()) {
      names.set(row.companyId, row.name);
    }
  }

  const switchByCompany = new Map(
    switchRows.map((row) => [row.key, { enabled: row.enabled === 1, reason: row.reason }]),
  );

  const employers = [...new Set([...sentByCompany.keys(), ...mailByCompany.keys()])].map(
    (companyId) => {
      const mail = mailByCompany.get(companyId) ?? emptyMailTotals();

      const sent = sentByCompany.get(companyId) ?? 0;

      return {
        applications: applicationsByCompany.get(companyId) ?? 0,
        ats: (atsByCompany.get(companyId) ?? []).toSorted(),
        auth: mail.auth,
        bounces: mail.bounces,
        companyId,
        employer: names.get(companyId) ?? companyId,
        killSwitch: switchByCompany.get(companyId) ?? null,
        replies: mail.replies,
        replyRate: replyRateOf(sent, mail.replies),
        sent,
        status: statusOf(sent, mail.replies, mail.bounces),
      };
    },
  );

  employers.sort((left, right) => {
    const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status];

    return rank === 0 ? right.sent - left.sent : rank;
  });

  const totals = {
    auth: emptyAuth(),
    bounces: employers.reduce((sum, row) => sum + row.bounces, 0),
    replies: employers.reduce((sum, row) => sum + row.replies, 0),
    sent: employers.reduce((sum, row) => sum + row.sent, 0),
  };

  for (const row of authRows) {
    totals.auth[row.auth] += row.total;
  }

  const domainRate = replyRateOf(totals.sent, totals.replies);

  const view = {
    alerts: employers.flatMap((row) =>
      row.status === "reply_alert"
        ? [
            {
              companyId: row.companyId,
              employer: row.employer,
              replies: row.replies,
              sent: row.sent,
            },
          ]
        : [],
    ),
    days,
    domainAlert: {
      active:
        totals.sent >= MAIL_DOMAIN_MIN_SENDS &&
        domainRate !== null &&
        domainRate < MAIL_REPLY_FLOOR,
      replies: totals.replies,
      replyRate: domainRate,
      sent: totals.sent,
    },
    employers,
    since,
    totals,
  } satisfies MailHealthView;

  return view;
}

export function readMailReplyCounts(db: AppDatabase, clock: Clock) {
  const view = readMailHealth(db, clock, MAIL_HEALTH_WINDOW_DAYS);

  const counts = {
    domain: { replies: view.totals.replies, sent: view.totals.sent },
    employers: view.employers.map((row) => ({
      employer: row.employer,
      key: row.companyId,
      replies: row.replies,
      sent: row.sent,
    })),
  } satisfies MailReplyCounts;

  return counts;
}
