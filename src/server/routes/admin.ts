import { validJson, validQuery } from "./validators.ts";
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { BackupMonitor } from "../platform/ports/backup.ts";
import type { DegradedFlagReader } from "../platform/degraded.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { InviteRow } from "../auth/invites.ts";
import { ADMIN_REFUSAL_CODES } from "./admin-refusals.ts";
import type { AdminEnv } from "./admin-refusals.ts";
import { resolveAdminAccessOwner } from "../admin/access-owner.ts";
import { createAdminRevealRoutes } from "./admin-reveal.ts";
import type { JobActionOutcome } from "../admin/jobs.ts";
import { cancelAdminJob, JOB_STATUS_FILTERS, listAdminJobs, retryAdminJob } from "../admin/jobs.ts";
import {
  adminSupportQuerySchema,
  listAdminSupport,
  openSupportTicketCount,
  replyToSupportTicket,
  updateAdminSupportTicket,
} from "../admin/support.ts";
import { supportReplySchema, supportTicketUpdateSchema } from "../../shared/support.ts";
import type { MailSender } from "../platform/mail/port.ts";

import {
  applications,
  attempts,
  bgJobs,
  grants,
  invites,
  killSwitches,
  mailboxes,
  messages,
  profiles,
  resumes,
  reviews,
  sessions,
  targets,
  users,
} from "../platform/db/schema.ts";
import { DEFAULT_IMPORT_SOURCE, importTags, readTagImports } from "../catalog/tag-import.ts";
import { accessVerifier } from "../platform/access/configured.ts";
import { authSecretConfig, catalogDatabasePath, env } from "../config/env.ts";
import {
  listAdminAudit,
  parseAuditCursor,
  queryAdminAudit,
  recordAdminAudit,
  shipAdminAudit,
} from "../platform/audit/index.ts";
import {
  acknowledgeAdminAlerts,
  readAdminAlerts,
  validateAdminSettingValue,
} from "../platform/admin-alerts.ts";
import { readAdminLlmUsage } from "../platform/llm/usage.ts";
import { applicationsLeft, balancesPerGrant, grantApplications } from "../billing/ledger.ts";
import { resumeAfterPayment } from "../billing/pause.ts";
import { enqueuePlannerDay } from "../dispatch/planner.ts";
import { ensurePrepDailyQueued } from "../pipeline/daily-prep.ts";
import { logError } from "../platform/log.ts";
import {
  BILLING_FILTERS,
  BILLING_USERS_PAGE_SIZE,
  billingUserView,
  billingUsersPage,
  marginAdminView,
} from "../billing/admin-view.ts";
import { REFUND_REASONS, refundGrant } from "../billing/refunds.ts";
import { reconciliationForAdmin } from "../billing/reconcile.ts";
import type { Payments } from "../platform/ports/payments.ts";
import { buildCostSummary, buildProviderReport } from "../dispatch/report.ts";
import { buildLabReport } from "../lab/report.ts";
import { LAB_JOB_KIND, labRunPayloadSchema } from "../lab/job.ts";
import { buildMarginReport } from "../billing/margin.ts";
import { FIXTURE_CAPTURE_JOB_KIND, fixtureCapturePayloadSchema } from "../fixtures/job.ts";
import { enqueueLiveCheckNow } from "../live-checks/job.ts";
import { readLiveCheckResults } from "../live-checks/store.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { readMailSummary } from "../platform/mail/budget.ts";
import { PERSONIO_PROBE_JOB_KIND, isPersonioProbeUrl } from "../probe/personio.ts";
import {
  getAllKillSwitches,
  getAllSettings,
  getSetting,
  setKillSwitch,
  setSetting,
} from "../platform/settings/index.ts";
import {
  findInvite,
  inviteEmailHash,
  inviteStatus,
  INVITE_GRANT_DAYS_KEY,
  INVITE_GRANT_QUANTITY_KEY,
} from "../auth/invites.ts";
import {
  markWaitlistInvited,
  waitlistCounts,
  waitlistEntriesFor,
  waitlistEntryById,
} from "../waitlist/store.ts";
import type { WaitlistEntryRow } from "../waitlist/store.ts";
import { WAITLIST_FILTERS, WAITLIST_ORDERS } from "../../shared/waitlist.ts";
import { normaliseEmail } from "../auth/email.ts";
import { readMailHealth } from "../inbox/health.ts";
import { buildStorageReport } from "../storage/report.ts";
import { checkpointDatabase } from "../storage/database-sizes.ts";
import { buildSystemReport, stripeModeOf } from "../system/report.ts";

const settingBody = z.object({ value: z.string().min(1) });

const jobsQuery = z.object({
  kind: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(JOB_STATUS_FILTERS).default("all"),
});

const suspendBody = z.object({ reason: z.string().trim().min(1).max(500) });

const usersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().default(""),
  status: z.enum(["all", "active", "suspended", "invited"]).default("all"),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const USERS_PAGE_SIZE = 5;

const usersPageRowSchema = z.object({
  createdAtMs: z.number(),
  email: z.string().nullable(),
  id: z.string(),
  kind: z.enum(["invite", "user"]),
  name: z.string().nullable(),
  status: z.enum(["active", "invited", "suspended"]),
});

const usersCountRowSchema = z.object({
  status: z.enum(["active", "invited", "suspended"]),
  total: z.number(),
});

interface AdminPersonRow {
  acceptedAt: number | null;
  createdAt: number;
  email: string | null;
  grant: { expiresAt: number | null; quantity: number; startsAt: number } | null;
  grantsLeft: number | null;
  id: string;
  inviteAt: number | null;
  kind: "invite" | "user";
  lastActiveAt: number | null;
  name: string | null;
  status: "active" | "invited" | "suspended";
}

function peopleCte(needle: string, matchingInviteIds: readonly string[]) {
  const pattern = `%${needle}%`;

  const search =
    needle.length === 0
      ? sql`1 = 1`
      : sql`(lower(name) LIKE ${pattern} OR lower(email) LIKE ${pattern})`;

  return sql`with people as (
    select 'user' as kind, id, created_at * 1000 as createdAtMs, email, name,
      case when suspended_at is null then 'active' else 'suspended' end as status
    from users
    where ${search}
    union all
    select 'invite' as kind, id, created_at * 1000 as createdAtMs, null as email, null as name,
      'invited' as status
    from invites
    where accepted_at is null and revoked_at is null
      and id in (select value from json_each(${JSON.stringify(matchingInviteIds)}))
  )`;
}

function readStringList(value: string) {
  try {
    return z.array(z.string()).parse(JSON.parse(value));
  } catch {
    return [];
  }
}

const killSwitchBody = z.object({
  enabled: z.boolean(),
  reason: z.string().default(""),
});

const grantBody = z.object({
  email: z.email(),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
  idempotencyKey: z.string().min(1),
  quantity: z.number().int().min(1).max(100_000),
});

const billingUsersQuery = z.object({
  filter: z.enum(BILLING_FILTERS).default("all"),
  page: z.coerce.number().int().min(1).default(1),
});

const refundBody = z.object({
  amountCents: z.number().int().min(1).max(100_000_000).nullable(),
  grantId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200),
  note: z.string().trim().min(1).max(500),
  reason: z.enum(REFUND_REASONS),
});

const tagImportBody = z.object({
  content: z.string().min(1),
  source: z.string().min(1).default(DEFAULT_IMPORT_SOURCE),
});

const inviteBody = z.object({ email: z.email() });

const waitlistQuery = z.object({
  status: z.enum(WAITLIST_FILTERS).default("all"),
  q: z.string().trim().default(""),
  order: z.enum(WAITLIST_ORDERS).default("newest"),
});

const llmUsageQuery = z.object({
  purpose: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const ATTEMPT_OUTCOME_FILTERS = [
  "all",
  "completed",
  "challenge_blocked",
  "error",
  "timeout",
] as const;

const ATTEMPT_OUTCOME_GROUPS = {
  challenge_blocked: ["captcha_blocked", "blocked"],
  completed: ["sent"],
  error: [
    "provider_error",
    "crash",
    "upload_failed",
    "form_changed",
    "identity_mismatch",
    "posting_closed",
    "duplicate",
    "needs_review",
    "unconfirmed",
    "interrupted",
  ],
  timeout: ["timeout", "code_timeout"],
} as const;

const attemptsQuery = z.object({
  applicationId: z.string().min(1).optional(),
  outcome: z.enum(ATTEMPT_OUTCOME_FILTERS).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const captureBody = fixtureCapturePayloadSchema;

const mailHealthQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((value) => value === 7 || value === 30)
    .default(30),
});

const storageReportQuery = z.object({
  dbstat: z
    .enum(["0", "1"])
    .default("0")
    .transform((value) => value === "1"),
});

const personioProbeBody = z.object({
  urls: z
    .array(z.url().refine((url) => isPersonioProbeUrl(url, env.NODE_ENV)))
    .min(1)
    .max(20)
    .optional(),
});

const personioProbeDetailSchema = z.object({
  index: z.number(),
  postingId: z.string(),
  url: z.string(),
  outcome: z.string(),
  questions: z.number(),
  required: z.number(),
  custom: z.number(),
  documents: z.number(),
  unhandled: z.string(),
});

const personioProbeSummarySchema = z.object({
  total: z.number(),
  readable: z.number(),
  needsReview: z.number(),
  unreadable: z.number(),
  unsupported: z.number(),
  passed: z.boolean(),
});

const auditQuery = z.object({
  action: z.string().trim().optional(),
  actorId: z.string().trim().optional(),
  before: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || parseAuditCursor(value) !== null, {
      message: "Invalid audit cursor",
    })
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().optional(),
  targetUserId: z.string().trim().optional(),
});

const ackAlertsBody = z.object({
  id: z.string().trim().min(1).optional(),
});

export interface AdminDeps {
  catalogDb: CatalogDatabase;
  providers: BrowserProviderRegistry | null;
  personal: PersonalCrypto;
  payments: Payments | null;
  backupObjects: ObjectStore | null;
  backups: BackupMonitor;
  databasePath: string;
  degraded: DegradedFlagReader;
  mail: MailSender;
  objects: ObjectStore;
}

const ATS_NAMES = ["greenhouse", "lever", "ashby", "workable", "personio"] as const;

function integrationsOf() {
  return {
    browserProvider: env.BROWSER_PROVIDER ?? null,
    cfAccessConfigured: Boolean(env.CF_ACCESS_AUD && env.CF_ACCESS_TEAM_DOMAIN),
    cloudflareEmailConfigured:
      env.CLOUDFLARE_EMAIL_API_TOKEN !== undefined &&
      env.CLOUDFLARE_ACCOUNT_ID !== undefined &&
      env.CLOUDFLARE_ZONE_ID !== undefined,
    demoLoginEnabled: env.DEMO_LOGIN_ENABLED,
    ntfyConfigured: env.ALERT_NTFY_URL !== undefined,
    publicSignupEnabled: env.PUBLIC_SIGNUP_ENABLED,
    stripeMode: stripeModeOf(env.STRIPE_SECRET_KEY),
    turnstileConfigured: env.TURNSTILE_SITE_KEY.length > 0 && env.TURNSTILE_SECRET.length > 0,
  };
}

export { ADMIN_REFUSAL_CODES } from "./admin-refusals.ts";

export { isAdminHost } from "../host-routing.ts";

function waitlistView(row: WaitlistEntryRow) {
  return {
    createdAt: row.createdAt,
    email: row.email,
    id: row.id,
    invitedAt: row.invitedAt,
    status: row.status,
    targetLocation: row.targetLocation,
    targetRole: row.targetRole,
    updatedAt: row.updatedAt,
  };
}

function jobActionResponse(context: Context<AdminEnv>, result: JobActionOutcome) {
  if (result.outcome === "not_found") {
    return context.json({ error: "not_found" }, 404);
  }

  if (result.outcome === "conflict") {
    return context.json({ error: result.reason, status: result.status }, 409);
  }

  return context.json({ job: result.job });
}

export function createAdminApi(db: AppDatabase, clock: Clock, deps: AdminDeps) {
  const routes = new Hono<AdminEnv>();

  routes.use("*", async (context, next) => {
    const identity = accessVerifier === null ? null : await accessVerifier.verify(context.req.raw);

    if (identity === null) {
      return context.json({ error: ADMIN_REFUSAL_CODES.accessRequired }, 401);
    }

    const resolved = await resolveAdminAccessOwner(db, clock, identity);

    if (!resolved.ok) {
      return context.json({ error: ADMIN_REFUSAL_CODES.ownerRequired }, 403);
    }

    context.set("owner", resolved.owner);

    await next();

    return context.res;
  });

  const inviteSecret = authSecretConfig.current;

  function grantViewOf(grantId: string | null) {
    if (grantId === null) {
      return null;
    }

    const row = db.select().from(grants).where(eq(grants.id, grantId)).get();

    return row === undefined
      ? null
      : { expiresAt: row.expiresAt, quantity: row.quantity, startsAt: row.startsAt };
  }

  async function invitationView(invite: InviteRow, ownerId: string) {
    const sealedBy = invite.invitedBy ?? ownerId;

    const email =
      invite.emailEnc === null
        ? null
        : await deps.personal
            .openFor(
              sealedBy,
              { table: "invites", column: "email_enc", rowId: invite.id },
              invite.emailEnc,
            )
            .catch(() => null);

    return {
      acceptedAt: invite.acceptedAt === null ? null : invite.acceptedAt.getTime(),
      acceptedUserId: invite.acceptedUserId,
      createdAt: invite.createdAt.getTime(),
      email,
      grant: grantViewOf(invite.grantId),
      grantId: invite.grantId,
      id: invite.id,
      invitedBy: invite.invitedBy,
      revokedAt: invite.revokedAt === null ? null : invite.revokedAt.getTime(),
      status: inviteStatus(invite),
    };
  }

  function lastActivityAt(userId: string) {
    const session = db
      .select({ at: sessions.updatedAt })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.updatedAt))
      .limit(1)
      .get();

    const application = db
      .select({ at: applications.updatedAt })
      .from(applications)
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.updatedAt))
      .limit(1)
      .get();

    const message = db
      .select({ at: messages.createdAt })
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(1)
      .get();

    const values = [
      session?.at.getTime() ?? null,
      application?.at ?? null,
      message?.at.getTime() ?? null,
    ];

    let latest: number | null = null;

    for (const value of values) {
      if (value !== null && (latest === null || value > latest)) {
        latest = value;
      }
    }

    return latest;
  }

  function adminGrantFor(userId: string) {
    const rows = db
      .select()
      .from(grants)
      .where(and(eq(grants.userId, userId), eq(grants.source, "admin")))
      .orderBy(asc(grants.startsAt))
      .all();

    if (rows.length === 0) {
      return null;
    }

    const balances = balancesPerGrant(db, userId);
    let quantity = 0;
    let remaining = 0;
    let used = 0;
    let opens = false;
    let startsAt = rows[0]?.startsAt ?? 0;
    let expiresAt: number | null = null;

    for (const row of rows) {
      const balance = balances.get(row.id);

      quantity += row.quantity;
      remaining += balance?.available ?? 0;
      used += balance?.used ?? 0;
      startsAt = Math.min(startsAt, row.startsAt);

      if (row.expiresAt === null) {
        opens = true;
      } else if (!opens) {
        expiresAt = Math.max(expiresAt ?? 0, row.expiresAt);
      }
    }

    return { expiresAt: opens ? null : expiresAt, quantity, remaining, startsAt, used };
  }

  function acceptedInviteFor(userId: string) {
    return (
      db
        .select()
        .from(invites)
        .where(eq(invites.acceptedUserId, userId))
        .orderBy(desc(invites.acceptedAt))
        .get() ?? null
    );
  }

  routes.get("/session", (context) => {
    const owner = context.get("owner");

    const row = db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, owner.userId))
      .get();

    return context.json({
      now: clock.now(),
      owner: { email: row?.email ?? owner.email, name: row?.name ?? "" },
    });
  });

  routes.get("/users", validQuery(usersQuery), async (context) => {
    const { page, q, status } = context.req.valid("query");
    const owner = context.get("owner");
    const now = clock.now();
    const needle = q.toLowerCase();

    const pendingInvites = db
      .select()
      .from(invites)
      .where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .all();

    const inviteViews = await Promise.all(
      pendingInvites.map(async (invite) => ({
        invite,
        view: await invitationView(invite, owner.userId),
      })),
    );

    const inviteById = new Map(inviteViews.map((entry) => [entry.invite.id, entry]));

    const matchingInviteIds = inviteViews.flatMap(({ invite, view }) =>
      needle.length === 0 || (view.email ?? "").toLowerCase().includes(needle) ? [invite.id] : [],
    );

    const pageRows = z.array(usersPageRowSchema).parse(
      db.all(
        sql`${peopleCte(needle, matchingInviteIds)}
          select kind, id, createdAtMs, email, name, status from people
          where ${status === "all" ? sql`1 = 1` : sql`status = ${status}`}
          order by createdAtMs desc, id asc
          limit ${USERS_PAGE_SIZE} offset ${(page - 1) * USERS_PAGE_SIZE}`,
      ),
    );

    const totalByStatus = new Map(
      z
        .array(usersCountRowSchema)
        .parse(
          db.all(
            sql`${peopleCte(needle, matchingInviteIds)}
              select status, count(*) as total from people group by status`,
          ),
        )
        .map((row) => [row.status, row.total]),
    );

    const counts = {
      active: totalByStatus.get("active") ?? 0,
      all: [...totalByStatus.values()].reduce((sum, total) => sum + total, 0),
      invited: totalByStatus.get("invited") ?? 0,
      suspended: totalByStatus.get("suspended") ?? 0,
    };

    const rows: AdminPersonRow[] = [];

    for (const row of pageRows) {
      if (row.kind === "invite") {
        const entry = inviteById.get(row.id);

        if (entry === undefined) {
          continue;
        }

        rows.push({
          acceptedAt: null,
          createdAt: entry.view.createdAt,
          email: entry.view.email,
          grant: null,
          grantsLeft: null,
          id: `invite:${entry.invite.id}`,
          inviteAt: entry.view.createdAt,
          kind: "invite",
          lastActiveAt: null,
          name: null,
          status: "invited",
        });

        continue;
      }

      const invite = acceptedInviteFor(row.id);
      const adminGrant = adminGrantFor(row.id);

      rows.push({
        acceptedAt: invite?.acceptedAt?.getTime() ?? null,
        createdAt: row.createdAtMs,
        email: row.email,
        grant:
          adminGrant === null
            ? null
            : {
                expiresAt: adminGrant.expiresAt,
                quantity: adminGrant.quantity,
                startsAt: adminGrant.startsAt,
              },
        grantsLeft: applicationsLeft(db, row.id, now),
        id: row.id,
        inviteAt: invite?.createdAt.getTime() ?? null,
        kind: "user",
        lastActiveAt: lastActivityAt(row.id),
        name: row.name,
        status: row.status,
      });
    }

    return context.json({
      counts,
      now,
      page,
      pageSize: USERS_PAGE_SIZE,
      rows,
      total: status === "all" ? counts.all : (totalByStatus.get(status) ?? 0),
    });
  });

  routes.get("/users/:id", async (context) => {
    const user = db
      .select()
      .from(users)
      .where(eq(users.id, context.req.param("id")))
      .get();

    if (user === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const invite = acceptedInviteFor(user.id);
    const mailbox = db.select().from(mailboxes).where(eq(mailboxes.userId, user.id)).get();

    const resume = db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, user.id), eq(resumes.isCurrent, true)))
      .get();

    const targetRow = db.select().from(targets).where(eq(targets.userId, user.id)).get();
    const adminGrant = adminGrantFor(user.id);
    const now = clock.now();
    const weekAgo = now - 7 * DAY_MS;

    const resumeFilename =
      resume === undefined
        ? null
        : await deps.personal
            .openFor(
              user.id,
              { table: "resumes", column: "filename_enc", rowId: resume.id },
              resume.filenameEnc,
            )
            .catch(() => null);

    const sentThisWeek =
      db
        .select({ total: count() })
        .from(applications)
        .where(
          and(
            eq(applications.userId, user.id),
            eq(applications.status, "sent"),
            gte(applications.sentAt, weekAgo),
          ),
        )
        .get()?.total ?? 0;

    const readyToSend =
      db
        .select({ total: count() })
        .from(applications)
        .where(
          and(
            eq(applications.userId, user.id),
            inArray(applications.status, ["ready", "approved"]),
          ),
        )
        .get()?.total ?? 0;

    const couldNotApply =
      db
        .select({ total: count() })
        .from(applications)
        .where(and(eq(applications.userId, user.id), eq(applications.status, "failed")))
        .get()?.total ?? 0;

    const reviewsOpen =
      db
        .select({ total: count() })
        .from(reviews)
        .where(and(eq(reviews.userId, user.id), eq(reviews.status, "open")))
        .get()?.total ?? 0;

    return context.json({
      now,
      user: {
        acceptedAt: invite?.acceptedAt?.getTime() ?? null,
        applicationsLeft: applicationsLeft(db, user.id, now),
        createdAt: user.createdAt.getTime(),
        email: user.email,
        emailVerified: user.emailVerified,
        forwardingAddress: mailbox === undefined ? null : `${mailbox.localPart}@${env.MAIL_DOMAIN}`,
        grant: adminGrant,
        id: user.id,
        inviteAt: invite?.createdAt.getTime() ?? null,
        lastActiveAt: lastActivityAt(user.id),
        name: user.name,
        resume:
          resume === undefined
            ? null
            : { filename: resumeFilename, uploadedAt: resume.uploadedAt.getTime() },
        role: user.role,
        stats: { couldNotApply, readyToSend, reviewsOpen, sentThisWeek },
        status: user.suspendedAt === null ? "active" : "suspended",
        suspendedAt: user.suspendedAt === null ? null : user.suspendedAt.getTime(),
        targets:
          targetRow === undefined
            ? null
            : {
                locations: readStringList(targetRow.locations),
                roles: readStringList(targetRow.roles),
              },
      },
    });
  });

  routes.post("/users/:id/suspend", validJson(suspendBody), async (context) => {
    const owner = context.get("owner");
    const { reason } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.id, context.req.param("id")))
      .get();

    if (user === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    if (user.role === "owner") {
      return context.json({ error: "owner_required" }, 409);
    }

    const at = new Date(clock.now());

    db.transaction((tx) => {
      tx.update(users).set({ suspendedAt: at, updatedAt: at }).where(eq(users.id, user.id)).run();

      tx.delete(sessions).where(eq(sessions.userId, user.id)).run();

      tx.insert(profiles)
        .values({
          userId: user.id,
          running: false,
          pauseReason: "suspended",
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: { pauseReason: "suspended", running: false, updatedAt: at },
        })
        .run();
    });

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "users.suspend",
      detail: { email: user.email, suspendedAt: at.getTime() },
      reason,
      targetUserId: user.id,
    });

    return context.json({ id: user.id, suspendedAt: at.getTime() });
  });

  routes.post("/users/:id/reinstate", validJson(suspendBody), async (context) => {
    const owner = context.get("owner");
    const { reason } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.id, context.req.param("id")))
      .get();

    if (user === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const at = new Date(clock.now());

    db.transaction((tx) => {
      tx.update(users).set({ suspendedAt: null, updatedAt: at }).where(eq(users.id, user.id)).run();

      tx.update(profiles)
        .set({ pauseReason: "user", running: false, updatedAt: at })
        .where(eq(profiles.userId, user.id))
        .run();
    });

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "users.reinstate",
      detail: { email: user.email, reinstatedAt: at.getTime() },
      reason,
      targetUserId: user.id,
    });

    return context.json({ id: user.id, suspendedAt: null });
  });

  routes.get("/overview", (context) => {
    const jobCounts = db
      .select({ status: bgJobs.status, total: count() })
      .from(bgJobs)
      .groupBy(bgJobs.status)
      .all();

    const userTotals = db
      .select({ total: count() })
      .from(users)
      .where(sql`${users.role} <> 'demo'`)
      .all();

    const ownerTotals = db
      .select({ total: count() })
      .from(users)
      .where(sql`${users.role} = 'owner'`)
      .all();

    const sessionTotals = db
      .select({ total: count() })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(sql`${users.role} <> 'demo'`)
      .all();

    const allSwitches = getAllKillSwitches(db);
    const audit = listAdminAudit(db, 20);

    const jobs: Record<string, number> = {};

    for (const row of jobCounts) {
      jobs[row.status] = row.total;
    }

    return context.json({
      now: clock.now(),
      jobs,
      users: { total: userTotals[0]?.total ?? 0, owners: ownerTotals[0]?.total ?? 0 },
      sessions: sessionTotals[0]?.total ?? 0,
      killSwitches: {
        total: allSwitches.length,
        enabled: allSwitches.filter((row) => row.enabled === 1).length,
      },
      openSupportTickets: openSupportTicketCount(db),
      cost: buildCostSummary(db, clock),
      mail: readMailSummary(db, clock.now()),
      audit: audit.map((row) => ({
        id: row.id,
        at: row.at.getTime(),
        actorId: row.actorId,
        action: row.action,
        targetUserId: row.targetUserId,
        reason: row.reason,
        detail: row.detail,
      })),
    });
  });

  routes.get("/jobs", validQuery(jobsQuery), (context) =>
    context.json(listAdminJobs(db, clock, context.req.valid("query"))),
  );
  routes.post("/jobs/:id/retry", async (context) => {
    const owner = context.get("owner");

    return jobActionResponse(
      context,
      await retryAdminJob(db, clock, context.req.param("id"), owner.userId),
    );
  });

  routes.post("/jobs/:id/cancel", async (context) => {
    const owner = context.get("owner");

    return jobActionResponse(
      context,
      await cancelAdminJob(db, clock, context.req.param("id"), owner.userId),
    );
  });

  routes.get("/storage-report", validQuery(storageReportQuery), async (context) =>
    context.json(
      await buildStorageReport({
        backups: deps.backupObjects,
        catalogDb: deps.catalogDb,
        clock,
        databasePath: deps.databasePath,
        db,
        includeTables: context.req.valid("query").dbstat,
        objects: deps.objects,
      }),
    ),
  );

  routes.get("/system", async (context) =>
    context.json(
      await buildSystemReport({
        backups: deps.backups,
        catalogDb: deps.catalogDb,
        clock,
        databasePath: deps.databasePath,
        db,
        degraded: deps.degraded,
        integrations: integrationsOf(),
      }),
    ),
  );

  routes.post("/system/checkpoint", async (context) => {
    const owner = context.get("owner");
    const report = checkpointDatabase(catalogDatabasePath);

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "system.wal_checkpoint",
      reason:
        report.busy === 0
          ? "Truncated the catalog database WAL from the system page; Litestream owns app.sqlite"
          : "The catalog WAL checkpoint stayed busy; another connection is reading the database",
      detail: {
        afterWalBytes: report.afterWalBytes,
        beforeWalBytes: report.beforeWalBytes,
        busy: report.busy,
        checkpointed: report.checkpointed,
      },
    });

    return context.json(report);
  });

  routes.get("/settings", (context) => context.json({ settings: getAllSettings(db) }));

  routes.put("/settings/:key", validJson(settingBody), async (context) => {
    const { key } = context.req.param();
    const { value } = context.req.valid("json");

    if (!validateAdminSettingValue(key, value)) {
      return context.json({ error: "invalid_setting_value" }, 400);
    }

    const owner = context.get("owner");

    const before = getSetting(db, key);

    setSetting(db, clock, key, value, owner.userId);

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "settings.update",
      reason: "Changed from the admin settings page",
      detail: { key, before: before ?? null, after: value },
    });

    return context.json({ key, value });
  });

  routes.get("/kill-switches", (context) => context.json({ switches: getAllKillSwitches(db) }));

  routes.put("/kill-switches/:scope/:key", validJson(killSwitchBody), async (context) => {
    const { scope, key } = context.req.param();
    const { enabled, reason } = context.req.valid("json");
    const owner = context.get("owner");
    const scopeCheck = z.enum(["global", "ats", "employer", "provider"]).safeParse(scope);

    if (!scopeCheck.success) {
      return context.json({ error: "invalid_scope" }, 400);
    }

    const before = getAllKillSwitches(db).find(
      (row) => row.scope === scopeCheck.data && row.key === key,
    );

    setKillSwitch(db, clock, scopeCheck.data, key, enabled, reason, "owner");

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "kill_switch.update",
      reason: reason.length > 0 ? reason : "Changed from the admin kill switches page",
      detail: {
        scope: scopeCheck.data,
        key,
        before: before === undefined ? null : before.enabled === 1,
        after: enabled,
      },
    });

    return context.json({ scope: scopeCheck.data, key, enabled, reason });
  });

  routes.get("/catalog", (context) => {
    const ats = ATS_NAMES.map((name) => {
      const hourlyLimitSetting = getSetting(db, `limits.ats_hourly.${name}`);

      const hourlyLimit = hourlyLimitSetting === null ? null : Number(hourlyLimitSetting);

      const enabledSwitch = db
        .select()
        .from(killSwitches)
        .where(sql`${killSwitches.scope} = 'ats' AND ${killSwitches.key} = ${name}`)
        .get();

      return {
        ats: name,
        hourlyLimit,
        killSwitchEnabled: enabledSwitch === undefined ? null : enabledSwitch.enabled === 1,
      };
    });

    return context.json({ discoveredAt: null, ats });
  });

  routes.get("/mail-health", validQuery(mailHealthQuery), (context) => {
    const { days } = context.req.valid("query");

    return context.json(readMailHealth(db, clock, days));
  });

  routes.get("/probes/personio", (context) => {
    const results = readLiveCheckResults(db, 500);
    const summary = results.find((result) => result.check === "probe.personio.summary") ?? null;
    const runId = summary?.runId ?? null;

    const forms = results
      .filter((result) => result.check === "probe.personio" && result.runId === runId)
      .flatMap((result) => {
        const parsed = personioProbeDetailSchema.safeParse(result.detail);

        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, 20);

    const parsedSummary =
      summary === null ? null : personioProbeSummarySchema.safeParse(summary.detail);

    return context.json({
      forms,
      ranAt: summary?.startedAt ?? null,
      summary: parsedSummary?.success === true ? parsedSummary.data : null,
    });
  });

  routes.post("/probes/personio", validJson(personioProbeBody), async (context) => {
    const owner = context.get("owner");
    const { urls } = context.req.valid("json");

    const job = enqueueJob(db, clock, PERSONIO_PROBE_JOB_KIND, JSON.stringify({ urls }), {
      maxAttempts: 1,
    });

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "probes.personio",
      reason: "Probed the open Personio forms before enabling the ATS",
      detail: { jobId: job.id, urls: urls?.length ?? 0 },
    });

    return context.json({ jobId: job.id });
  });

  routes.get("/audit", validQuery(auditQuery), (context) => {
    const query = context.req.valid("query");
    const page = queryAdminAudit(db, query);

    const entries = page.entries.map((row) => ({
      id: row.id,
      at: row.at.getTime(),
      actorId: row.actorId,
      action: row.action,
      targetUserId: row.targetUserId,
      reason: row.reason,
      detail: row.detail,
    }));

    return context.json({
      audit: entries,
      entries,
      nextCursor: page.nextCursor,
    });
  });

  routes.get("/alerts", (context) => {
    const owner = context.get("owner");

    return context.json(
      readAdminAlerts({
        backupStatus: deps.backups.status(),
        clock,
        db,
        ownerUserId: owner.userId,
        readinessEnv: {
          alertNtfyConfigured: env.ALERT_NTFY_URL !== undefined,
          cfAccessConfigured:
            env.CF_ACCESS_AUD !== undefined && env.CF_ACCESS_TEAM_DOMAIN !== undefined,
          publicSignupEnabled: env.PUBLIC_SIGNUP_ENABLED,
          stripeSecretKey: env.STRIPE_SECRET_KEY,
          stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
        },
      }),
    );
  });

  routes.post("/alerts/ack", validJson(ackAlertsBody), async (context) => {
    const owner = context.get("owner");
    const { id } = context.req.valid("json");
    const outcome = acknowledgeAdminAlerts(db, clock, owner.userId, id);

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "alerts.ack",
      detail: {
        acknowledged: outcome.acknowledged,
        notificationId: id ?? null,
      },
      reason:
        id === undefined
          ? "Acknowledged all unread owner alerts"
          : "Acknowledged owner alert notification",
    });

    return context.json(outcome);
  });

  routes.post("/tag-imports", validJson(tagImportBody), async (context) => {
    const owner = context.get("owner");
    const { content, source } = context.req.valid("json");

    const report = importTags({ db, catalogDb: deps.catalogDb }, clock, {
      content,
      source,
      uploadedBy: owner.userId,
    });

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "tag_imports.create",
      reason: `Imported a tag file from ${source}`,
      detail: {
        id: report.id,
        source,
        rows: report.rows,
        matched: report.matched,
        unmatched: report.unmatched,
      },
    });

    return context.json(report);
  });

  routes.get("/tag-imports", (context) => context.json({ tagImports: readTagImports(db) }));

  routes.get("/invites", async (context) => {
    const owner = context.get("owner");
    const rows = db.select().from(invites).orderBy(desc(invites.createdAt)).all();

    const views = await Promise.all(rows.map(async (row) => invitationView(row, owner.userId)));

    const quantity = Number(getSetting(db, INVITE_GRANT_QUANTITY_KEY) ?? 300);
    const days = Number(getSetting(db, INVITE_GRANT_DAYS_KEY) ?? 30);

    return context.json({
      grant: {
        days: Number.isFinite(days) && days > 0 ? days : 30,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 300,
      },
      invites: views,
    });
  });

  routes.post("/invites", validJson(inviteBody), async (context) => {
    const owner = context.get("owner");
    const email = context.req.valid("json").email.trim();

    const currentUser = db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.mailbox, normaliseEmail(email)))
      .get();

    if (currentUser !== undefined) {
      return context.json({ error: "user_exists" }, 409);
    }

    const existing = findInvite(db, authSecretConfig.accepted, email);

    if (existing !== null) {
      if (existing.acceptedAt !== null) {
        return context.json({ error: "already_accepted" }, 409);
      }

      if (existing.revokedAt === null) {
        return context.json({ error: "already_invited" }, 409);
      }
    }

    const emailHash = existing?.emailHash ?? inviteEmailHash(inviteSecret, email);
    const id = existing?.id ?? crypto.randomUUID();

    const emailEnc = await deps.personal.sealFor(
      owner.userId,
      { table: "invites", column: "email_enc", rowId: id },
      email,
    );

    const createdAt = new Date(clock.now());

    if (existing === null) {
      db.insert(invites)
        .values({
          id,
          emailHash,
          emailEnc,
          invitedBy: owner.userId,
          acceptedAt: null,
          acceptedUserId: null,
          revokedAt: null,
          grantId: null,
          createdAt,
        })
        .run();
    } else {
      db.update(invites)
        .set({
          emailEnc,
          invitedBy: owner.userId,
          acceptedAt: null,
          acceptedUserId: null,
          revokedAt: null,
          grantId: null,
          createdAt,
        })
        .where(eq(invites.id, id))
        .run();
    }

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "invites.create",
      reason: `Invited a person to the beta`,
      detail: { email, inviteId: id },
    });

    const row = db.select().from(invites).where(eq(invites.id, id)).get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json({ invite: await invitationView(row, owner.userId) }, 201);
  });

  routes.post("/invites/:id/revoke", async (context) => {
    const owner = context.get("owner");

    const row = db
      .select()
      .from(invites)
      .where(eq(invites.id, context.req.param("id")))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    if (row.acceptedAt !== null) {
      return context.json({ error: "already_accepted" }, 409);
    }

    if (row.revokedAt === null) {
      const revokedAt = new Date(clock.now());

      db.update(invites).set({ revokedAt }).where(eq(invites.id, row.id)).run();

      await recordAdminAudit(db, clock, {
        actorId: owner.userId,
        action: "invites.revoke",
        reason: `Revoked the invitation for ${row.id}`,
        detail: { inviteId: row.id },
      });

      const revoked = db.select().from(invites).where(eq(invites.id, row.id)).get();

      if (revoked === undefined) {
        return context.json({ error: "not_found" }, 404);
      }

      return context.json({ invite: await invitationView(revoked, owner.userId) });
    }

    return context.json({ invite: await invitationView(row, owner.userId) });
  });

  routes.get("/waitlist", validQuery(waitlistQuery), (context) => {
    const { status, q, order } = context.req.valid("query");
    const rows = waitlistEntriesFor(db, { order, q, status });

    return context.json({
      counts: waitlistCounts(db),
      entries: rows.map((row) => waitlistView(row)),
      total: rows.length,
    });
  });

  routes.post("/waitlist/:id/invite", async (context) => {
    const owner = context.get("owner");
    const row = waitlistEntryById(db, context.req.param("id"));

    if (row === null) {
      return context.json({ error: "not_found" }, 404);
    }

    if (row.status === "joined") {
      return context.json({ emailed: false, entry: waitlistView(row) });
    }

    const existing = findInvite(db, authSecretConfig.accepted, row.email);

    if (existing !== null && (existing.acceptedAt !== null || existing.revokedAt === null)) {
      const updated = markWaitlistInvited(db, clock, row.id) ?? row;

      return context.json({ emailed: false, entry: waitlistView(updated) });
    }

    const inviteId = existing?.id ?? crypto.randomUUID();
    const emailHash = existing?.emailHash ?? inviteEmailHash(inviteSecret, row.email);

    const emailEnc = await deps.personal.sealFor(
      owner.userId,
      { table: "invites", column: "email_enc", rowId: inviteId },
      row.email,
    );

    const createdAt = new Date(clock.now());

    if (existing === null) {
      db.insert(invites)
        .values({
          id: inviteId,
          emailHash,
          emailEnc,
          invitedBy: owner.userId,
          acceptedAt: null,
          acceptedUserId: null,
          revokedAt: null,
          grantId: null,
          createdAt,
        })
        .run();
    } else {
      db.update(invites)
        .set({
          acceptedAt: null,
          acceptedUserId: null,
          createdAt,
          emailEnc,
          grantId: null,
          invitedBy: owner.userId,
          revokedAt: null,
        })
        .where(eq(invites.id, inviteId))
        .run();
    }

    try {
      await deps.mail.sendWaitlistInvite({
        to: row.email,
        url: `${env.APP_ORIGIN ?? env.ADMIN_ORIGIN}/signin`,
      });
    } catch (error) {
      db.update(invites)
        .set({ revokedAt: new Date(clock.now()) })
        .where(eq(invites.id, inviteId))
        .run();
      logError("admin.waitlist.invite", error);

      return context.json({ error: "mail_failed" }, 502);
    }

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "waitlist.invite",
      reason: `Invited ${row.email} from the waitlist`,
      detail: { email: row.email, inviteId, waitlistId: row.id },
    });

    const updated = markWaitlistInvited(db, clock, row.id) ?? row;

    return context.json({ emailed: true, entry: waitlistView(updated) }, 201);
  });

  routes.get("/grants", (context) => {
    const rows = db
      .select({ grant: grants, email: users.email })
      .from(grants)
      .innerJoin(users, eq(grants.userId, users.id))
      .orderBy(desc(grants.createdAt))
      .limit(50)
      .all();

    return context.json({
      grants: rows.map((row) => ({
        createdAt: row.grant.createdAt,
        email: row.email,
        expiresAt: row.grant.expiresAt,
        id: row.grant.id,
        quantity: row.grant.quantity,
        source: row.grant.source,
        startsAt: row.grant.startsAt,
      })),
    });
  });

  routes.post("/grants", validJson(grantBody), async (context) => {
    const { email, expiresInDays, idempotencyKey, quantity } = context.req.valid("json");
    const owner = context.get("owner");
    const user = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();

    if (user === undefined) {
      return context.json({ error: "user_not_found" }, 404);
    }

    const at = clock.now();
    const expiresAt = expiresInDays === null ? null : at + expiresInDays * 24 * 60 * 60 * 1000;

    const placed = grantApplications(db, clock, {
      expiresAt,
      idempotencyKey,
      quantity,
      source: "admin",
      userId: user.id,
    });

    if (!placed.created) {
      if (placed.entry.userId !== user.id || placed.entry.amount !== quantity) {
        return context.json({ error: "idempotency_key_reused" }, 422);
      }

      return context.json({
        applicationsLeft: applicationsLeft(db, user.id, at),
        grantId: placed.grantId,
      });
    }

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "grants.create",
      detail: {
        email: user.email,
        grantId: placed.grantId,
        quantity,
      },
      reason: `Granted ${String(quantity)} Applications from the admin grants page`,
      targetUserId: user.id,
    });

    const pauseReason = db
      .select({ pauseReason: profiles.pauseReason })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .get()?.pauseReason;

    if (
      pauseReason === "plan_ended" &&
      resumeAfterPayment(db, clock, { userId: user.id }).resumed
    ) {
      enqueuePlannerDay(db, clock, user.id);
      ensurePrepDailyQueued(db, clock, user.id);
    }

    return context.json({
      applicationsLeft: applicationsLeft(db, user.id, at),
      grantId: placed.grantId,
    });
  });

  routes.get("/billing/users", validQuery(billingUsersQuery), (context) => {
    const { filter, page } = context.req.valid("query");

    return context.json({
      pageSize: BILLING_USERS_PAGE_SIZE,
      ...billingUsersPage(db, clock, { filter, page }),
    });
  });

  routes.get("/billing/reconciliation", (context) =>
    context.json({ reconciliation: reconciliationForAdmin(db) }),
  );

  routes.get("/billing/users/:id", (context) => {
    const view = billingUserView(db, clock, context.req.param("id"));

    return view === null
      ? context.json({ error: "user_not_found" }, 404)
      : context.json({ user: view });
  });

  routes.post("/billing/refunds", validJson(refundBody), async (context) => {
    const { payments } = deps;

    if (payments === null) {
      return context.json({ error: "billing_disabled" }, 503);
    }

    const owner = context.get("owner");
    const body = context.req.valid("json");

    let outcome: Awaited<ReturnType<typeof refundGrant>>;

    try {
      outcome = await refundGrant(
        { clock, db, payments, shipAudit: shipAdminAudit },
        { ...body, actorId: owner.userId },
      );
    } catch (error) {
      logError("billing.refund", error);

      return context.json({ error: "stripe_error" }, 502);
    }

    if (outcome.kind === "refunded") {
      return context.json({ refund: outcome.refund, replayed: outcome.replayed });
    }

    if (outcome.kind === "idempotency_key_reused") {
      return context.json({ error: outcome.kind }, 422);
    }

    const status = outcome.kind === "not_found" ? 404 : 409;

    return context.json({ error: outcome.kind }, status);
  });

  routes.get("/llm-usage", validQuery(llmUsageQuery), (context) => {
    const { purpose, limit } = context.req.valid("query");

    return context.json(
      readAdminLlmUsage(db, clock, {
        expectedModel: env.ANTHROPIC_MODEL,
        limit,
        purpose: purpose ?? null,
      }),
    );
  });

  routes.get("/attempts", validQuery(attemptsQuery), (context) => {
    const { applicationId, outcome, limit } = context.req.valid("query");

    const baseFilter =
      applicationId === undefined ? undefined : eq(attempts.applicationId, applicationId);

    const outcomeFilter =
      outcome === "all" ? undefined : inArray(attempts.outcome, ATTEMPT_OUTCOME_GROUPS[outcome]);

    const filters = [baseFilter, outcomeFilter].filter((clause) => clause !== undefined);
    const whereClause = filters.length === 0 ? undefined : and(...filters);

    const countRows = db
      .select({ outcome: attempts.outcome, total: count() })
      .from(attempts)
      .where(baseFilter)
      .groupBy(attempts.outcome)
      .all();

    const counts = {
      active: 0,
      all: 0,
      challenge_blocked: 0,
      completed: 0,
      error: 0,
      timeout: 0,
    };

    const challengeOutcomes = new Set<string>(ATTEMPT_OUTCOME_GROUPS.challenge_blocked);
    const completedOutcomes = new Set<string>(ATTEMPT_OUTCOME_GROUPS.completed);
    const timeoutOutcomes = new Set<string>(ATTEMPT_OUTCOME_GROUPS.timeout);

    for (const row of countRows) {
      counts.all += row.total;

      if (row.outcome === null) {
        counts.active += row.total;
      } else if (completedOutcomes.has(row.outcome)) {
        counts.completed += row.total;
      } else if (challengeOutcomes.has(row.outcome)) {
        counts.challenge_blocked += row.total;
      } else if (timeoutOutcomes.has(row.outcome)) {
        counts.timeout += row.total;
      } else {
        counts.error += row.total;
      }
    }

    const rows = db
      .select({
        attempt: attempts,
        ats: applications.ats,
        companyName: applications.companyName,
        postingTitle: applications.postingTitle,
      })
      .from(attempts)
      .innerJoin(applications, eq(attempts.applicationId, applications.id))
      .where(whereClause)
      .orderBy(desc(attempts.startedAt))
      .limit(limit)
      .all();

    return context.json({
      now: clock.now(),
      counts,
      attempts: rows.map((row) => ({
        applicationId: row.attempt.applicationId,
        ats: row.ats,
        browserMs: row.attempt.browserMs,
        captchaSeen: row.attempt.captchaSeen,
        codeUsed: row.attempt.codeUsed,
        companyName: row.companyName,
        costMicros: row.attempt.costMicros,
        endedAt: row.attempt.endedAt,
        errorCode: row.attempt.errorCode,
        id: row.attempt.id,
        outcome: row.attempt.outcome,
        postingTitle: row.postingTitle,
        provider: row.attempt.provider,
        providerSessionId: row.attempt.providerSessionId,
        proxyBytes: row.attempt.proxyBytes,
        startedAt: row.attempt.startedAt,
        liveUrl: `/admin/api/attempts/${row.attempt.id}/live`,
        replayUrl: `/admin/api/attempts/${row.attempt.id}/replay`,
      })),
    });
  });

  routes.get("/attempts/:id/live", async (context) => {
    const attempt = db
      .select()
      .from(attempts)
      .where(eq(attempts.id, context.req.param("id")))
      .get();

    if (attempt === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const sessionId = attempt.providerSessionId;

    if (sessionId === null) {
      return context.json({ error: "not_found" }, 404);
    }

    const provider = deps.providers?.all().find((candidate) => candidate.id === attempt.provider);

    if (provider === undefined) {
      return context.json({ error: "provider_unavailable" }, 404);
    }

    const view = await provider.view(sessionId);

    if (view === null) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json(view);
  });

  routes.get("/attempts/:id/replay", async (context) => {
    const attempt = db
      .select()
      .from(attempts)
      .where(eq(attempts.id, context.req.param("id")))
      .get();

    if (attempt === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const sessionId = attempt.providerSessionId;

    if (sessionId === null) {
      return context.json({ error: "not_found" }, 404);
    }

    const provider = deps.providers?.all().find((candidate) => candidate.id === attempt.provider);

    if (provider === undefined) {
      return context.json({ error: "provider_unavailable" }, 404);
    }

    const view = await provider.view(sessionId);
    const recordingUrl = view?.recordingUrl ?? null;

    if (recordingUrl === null) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json({ recordingUrl });
  });

  routes.get("/margin", (context) => context.json(marginAdminView(buildMarginReport(db, clock))));

  routes.get("/provider-report", (context) =>
    context.json({ lab: buildLabReport(db), providers: buildProviderReport(db, clock) }),
  );

  routes.post("/lab/runs", validJson(labRunPayloadSchema), async (context) => {
    if (deps.providers === null) {
      return context.json({ error: "browser_provider_unconfigured" }, 503);
    }

    if (env.LAB_BASE_URL === undefined && env.APP_ORIGIN === undefined) {
      return context.json({ error: "lab_unconfigured" }, 503);
    }

    const owner = context.get("owner");

    const input = context.req.valid("json");

    const active = db
      .select({ id: bgJobs.id })
      .from(bgJobs)
      .where(and(eq(bgJobs.kind, LAB_JOB_KIND), inArray(bgJobs.status, ["queued", "running"])))
      .limit(1)
      .get();

    if (active !== undefined) {
      return context.json({ jobId: active.id });
    }

    const job = enqueueJob(db, clock, LAB_JOB_KIND, JSON.stringify(input), {
      dedupeKey: "lab.run.queued",
      maxAttempts: 1,
    });

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "lab.run",
      reason: "Run the synthetic lab sessions",
      detail: {
        jobId: job.id,
        pages: input.pages.length,
        providers: input.providers.join(","),
        sessionsPerPage: input.sessionsPerPage,
      },
    });

    return context.json({ jobId: job.id });
  });

  routes.get("/live-checks", (context) => context.json({ results: readLiveCheckResults(db, 100) }));

  async function runLiveChecksNow(actorId: string) {
    const job = enqueueLiveCheckNow(db, clock);

    await recordAdminAudit(db, clock, {
      actorId,
      action: "live-checks.run",
      reason: "Run the daily live checks now",
      detail: { jobId: job.id },
    });

    return job.id;
  }

  routes.post("/live-checks", async (context) =>
    context.json({ jobId: await runLiveChecksNow(context.get("owner").userId) }),
  );

  routes.post("/live-checks/run", async (context) =>
    context.json({ jobId: await runLiveChecksNow(context.get("owner").userId) }),
  );

  routes.post("/fixtures/capture", validJson(captureBody), async (context) => {
    if (deps.providers === null) {
      return context.json({ error: "browser_provider_unconfigured" }, 503);
    }

    const owner = context.get("owner");

    const input = context.req.valid("json");

    const job = enqueueJob(db, clock, FIXTURE_CAPTURE_JOB_KIND, JSON.stringify(input), {
      maxAttempts: 1,
    });

    await recordAdminAudit(db, clock, {
      actorId: owner.userId,
      action: "fixtures.capture",
      reason: `Capture ${input.ats} forms for the test fixtures`,
      detail: { ats: input.ats, applyUrls: input.applyUrls.length, jobId: job.id },
    });

    return context.json({ jobId: job.id });
  });

  routes.get("/support", validQuery(adminSupportQuerySchema), async (context) =>
    context.json(
      await listAdminSupport({ clock, db, personal: deps.personal }, context.req.valid("query")),
    ),
  );

  routes.patch("/support/:id", validJson(supportTicketUpdateSchema), async (context) => {
    context.header("Cache-Control", "private, no-store");

    const owner = context.get("owner");

    const result = await updateAdminSupportTicket(
      { clock, db, personal: deps.personal },
      {
        actorId: owner.userId,
        id: context.req.param("id"),
        update: context.req.valid("json"),
      },
    );

    return result.outcome === "not_found"
      ? context.json({ error: "not_found" }, 404)
      : context.json({ ticket: result.ticket });
  });

  routes.post("/support/:id/reply", validJson(supportReplySchema), async (context) => {
    context.header("Cache-Control", "private, no-store");

    const owner = context.get("owner");

    const result = await replyToSupportTicket(
      { clock, db, mail: deps.mail, personal: deps.personal },
      {
        actorId: owner.userId,
        id: context.req.param("id"),
        message: context.req.valid("json").message,
      },
    );

    if (result.outcome === "not_found") {
      return context.json({ error: "not_found" }, 404);
    }

    if (result.outcome === "mail_failed") {
      return context.json({ error: "mail_send_failed", referenceId: result.referenceId }, 502);
    }

    return context.json({ ok: true, referenceId: result.referenceId });
  });

  routes.route("/", createAdminRevealRoutes(db, clock, deps.personal));

  return routes;
}
