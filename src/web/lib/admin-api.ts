import { z } from "zod";

import { taggingReportSchema } from "../../shared/tagging-report.ts";
import { waitlistInviteResponseSchema, waitlistResponseSchema } from "../../shared/waitlist.ts";

export const adminRefusalCodeSchema = z.enum(["access_required", "owner_required"]);

export const auditRowSchema = z.object({
  id: z.string(),
  at: z.number(),
  actorId: z.string(),
  action: z.string(),
  targetUserId: z.string().nullable(),
  reason: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const adminAuditPageSchema = z.object({
  entries: z.array(auditRowSchema),
  nextCursor: z.string().nullable(),
});

export const adminAlertProblemSchema = z.object({
  code: z.enum([
    "kill_switch_active",
    "dead_jobs",
    "mail_cap_reached",
    "mail_reserve_reached",
    "mail_cap_near",
    "backup_unavailable",
    "backup_lag",
    "health_degraded",
  ]),
  detail: z.string(),
  id: z.string(),
  severity: z.enum(["critical", "warning"]),
  title: z.string(),
});

export const adminAlertNotificationSchema = z.object({
  body: z.string(),
  createdAt: z.number(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
  id: z.string(),
  readAt: z.number().nullable(),
  title: z.string(),
  url: z.string(),
});

export const launchReadinessSchema = z.object({
  alertNtfyConfigured: z.boolean(),
  browserConcurrency: z.number(),
  cfAccessConfigured: z.boolean(),
  costGate: z.object({
    completed: z.number(),
    costGateMet: z.boolean().nullable(),
    costGateMicros: z.number(),
    costMicrosPerCompleted: z.number().nullable(),
  }),
  dailyCap: z.number(),
  publicSignupEnabled: z.boolean(),
  stripeMode: z.enum(["live", "test", "disabled"]),
});

export const adminAlertsResponseSchema = z.object({
  notifications: z.array(adminAlertNotificationSchema),
  now: z.number(),
  problems: z.array(adminAlertProblemSchema),
  readiness: launchReadinessSchema,
  unreadCount: z.number(),
});

export const ackAlertsResponseSchema = z.object({
  acknowledged: z.number(),
  readAt: z.number(),
});

const applicationLookupTimelineSchema = z.object({
  at: z.number(),
  attemptId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  fromValue: z.string().nullable(),
  id: z.string(),
  kind: z.string(),
  reason: z.string().nullable(),
  source: z.string(),
  toValue: z.string().nullable(),
});

export const applicationLookupSchema = z.object({
  now: z.number(),
  application: z
    .object({
      approvedAt: z.number().nullable(),
      ats: z.string().nullable(),
      attempts: z.number(),
      closedReason: z.string().nullable(),
      companyName: z.string(),
      cost: z.object({
        browserMicros: z.number(),
        llmMicros: z.number(),
        recordedAt: z.number().nullable(),
        retryMicros: z.number(),
      }),
      createdAt: z.number(),
      id: z.string(),
      origin: z.string(),
      postingTitle: z.string(),
      postingUrl: z.string(),
      readyAt: z.number().nullable(),
      scheduledFor: z.number().nullable(),
      scoreAtQueue: z.number().nullable(),
      sentAt: z.number().nullable(),
      stage: z.string().nullable(),
      stageLocked: z.boolean(),
      status: z.string(),
      statusReason: z.string().nullable(),
      updatedAt: z.number(),
      userId: z.string(),
    })
    .nullable(),
  attempts: z.array(
    z.object({
      browserMs: z.number().nullable(),
      costMicros: z.number().nullable(),
      endedAt: z.number().nullable(),
      errorCode: z.string().nullable(),
      id: z.string(),
      n: z.number(),
      outcome: z.string().nullable(),
      provider: z.string(),
      providerSessionId: z.string().nullable(),
      startedAt: z.number(),
      submitClickedAt: z.number().nullable(),
      submitResponseStatus: z.number().nullable(),
    }),
  ),
  balance: z
    .object({
      balances: z.record(z.string(), z.number()),
      grants: z.array(
        z.object({
          expiresAt: z.number().nullable(),
          id: z.string(),
          quantity: z.number(),
          source: z.string(),
          startsAt: z.number(),
        }),
      ),
      ledger: z.array(
        z.object({
          amount: z.number(),
          createdAt: z.number(),
          creditAccount: z.string(),
          debitAccount: z.string(),
          grantId: z.string(),
          id: z.string(),
          kind: z.string(),
        }),
      ),
    })
    .nullable(),
  confirmation: z.object({
    receipt: z.object({ confirmedAt: z.number(), messageId: z.string() }).nullable(),
    snapshot: z
      .object({
        approvedAt: z.number().nullable(),
        confirmedBy: z.string(),
        consentVersion: z.string(),
        costMicros: z.number(),
        provider: z.string(),
        submittedAt: z.number(),
      })
      .nullable(),
  }),
  mail: z.array(
    z.object({
      employerStarted: z.boolean(),
      id: z.string(),
      lastMessageAt: z.number(),
      messages: z.array(
        z.object({
          auth: z.string(),
          classification: z.string().nullable(),
          createdAt: z.number(),
          direction: z.string(),
          id: z.string(),
          outStatus: z.string().nullable(),
          senderDomain: z.string(),
          subject: z.string().nullable(),
        }),
      ),
      subject: z.string().nullable(),
    }),
  ),
  queue: z.object({
    jobs: z.array(
      z.object({
        attempts: z.number(),
        createdAt: z.number(),
        id: z.string(),
        kind: z.string(),
        lastError: z.string().nullable(),
        maxAttempts: z.number(),
        runAt: z.number(),
        status: z.string(),
        updatedAt: z.number(),
      }),
    ),
    scheduledFor: z.number().nullable(),
  }),
  screenshots: z.array(
    z.object({
      at: z.number(),
      attemptId: z.string(),
      bytes: z.number().nullable(),
      key: z.string(),
      phase: z.string(),
    }),
  ),
  timeline: z.array(applicationLookupTimelineSchema),
});

export type ApplicationLookup = z.infer<typeof applicationLookupSchema>;

export const overviewSchema = z.object({
  now: z.number(),
  jobs: z.record(z.string(), z.number()),
  users: z.object({ total: z.number(), owners: z.number() }),
  sessions: z.number(),
  killSwitches: z.object({ total: z.number(), enabled: z.number() }),
  openSupportTickets: z.number(),
  cost: z.object({
    completed: z.number(),
    costGateMicros: z.number(),
    costGateMet: z.boolean().nullable(),
    costMicrosPerCompleted: z.number().nullable(),
    proxyMbPerCompleted: z.number().nullable(),
    proxyTrend: z.boolean(),
  }),
  mail: z.object({
    month: z.string(),
    total: z.number(),
    cap: z.number(),
    reserve: z.number(),
    noticeLimit: z.number(),
    auth: z.number(),
    system: z.number(),
    notice: z.number(),
    warnedAt: z.number().nullable(),
    reserveRefusedAt: z.number().nullable(),
    refusedAt: z.number().nullable(),
    baseCap: z.number(),
    perSubscriber: z.number(),
    subscribers: z.number(),
    warningAt: z.number(),
    warningShare: z.number(),
    capReached: z.boolean(),
    reserveReached: z.boolean(),
  }),
  audit: z.array(auditRowSchema),
});

export const jobStatusSchema = z.enum(["queued", "running", "failed", "dead", "done"]);

export const jobStatusFilterSchema = z.enum([
  "all",
  "queued",
  "running",
  "failed",
  "dead",
  "completed",
]);

export const jobRowSchema = z.object({
  attempts: z.number(),
  createdAt: z.number(),
  dedupeKey: z.string().nullable(),
  id: z.string(),
  kind: z.string(),
  lastError: z.string().nullable(),
  lockedUntil: z.number().nullable(),
  maxAttempts: z.number(),
  payloadPreview: z.string(),
  priority: z.number(),
  runAt: z.number(),
  status: jobStatusSchema,
  updatedAt: z.number(),
});

export const jobsResponseSchema = z.object({
  counts: z.object({
    queued: z.number(),
    running: z.number(),
    done: z.number(),
    failed: z.number(),
    dead: z.number(),
    total: z.number(),
  }),
  countsByKindStatus: z.array(
    z.object({
      kind: z.string(),
      status: jobStatusSchema,
      total: z.number(),
    }),
  ),
  kinds: z.array(z.string()),
  jobs: z.array(jobRowSchema),
  limit: z.number(),
  now: z.number(),
  total: z.number(),
});

export const jobActionResponseSchema = z.object({ job: jobRowSchema });

export type JobRow = z.infer<typeof jobRowSchema>;

export type JobStatus = z.infer<typeof jobStatusSchema>;

export type JobStatusFilter = z.infer<typeof jobStatusFilterSchema>;

export type JobsResponse = z.infer<typeof jobsResponseSchema>;

export const providerReportRowSchema = z.object({
  ats: z.string(),
  attempted: z.number(),
  attemptCount: z.number(),
  challengeRate: z.number().nullable(),
  codeRate: z.number().nullable(),
  completed: z.number(),
  completionRate: z.number().nullable(),
  costGateMet: z.boolean().nullable(),
  costGateMicros: z.number(),
  costMicrosPerCompleted: z.number().nullable(),
  p50BrowserMs: z.number().nullable(),
  p95BrowserMs: z.number().nullable(),
  provider: z.string(),
  proxyMbPerCompleted: z.number().nullable(),
  proxyTrend: z.boolean(),
  sentAttemptCount: z.number(),
});

export const labReportRowSchema = z.object({
  ats: z.string().nullable(),
  captchaScore: z.number().nullable(),
  challengeRate: z.number().nullable(),
  codeRate: z.number().nullable(),
  completed: z.number(),
  completionRate: z.number().nullable(),
  costMicrosPerCompleted: z.number().nullable(),
  lastError: z.string().nullable(),
  p50DurationMs: z.number().nullable(),
  p95DurationMs: z.number().nullable(),
  page: z.string(),
  provider: z.string(),
  proxyMbPerCompleted: z.number().nullable(),
  sessions: z.number(),
});

export const providerReportSchema = z.object({
  lab: z.array(labReportRowSchema),
  providers: z.array(providerReportRowSchema),
});

export const labRunResponseSchema = z.object({ jobId: z.string() });

export const settingsResponseSchema = z.object({
  settings: z.record(z.string(), z.string()),
});

export const settingResponseSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const killSwitchRowSchema = z.object({
  scope: z.string(),
  key: z.string(),
  enabled: z.number(),
  reason: z.string(),
  setBy: z.string(),
  setAt: z.number(),
});

export const killSwitchesResponseSchema = z.object({
  switches: z.array(killSwitchRowSchema),
});

export const killSwitchResponseSchema = z.object({
  scope: z.string(),
  key: z.string(),
  enabled: z.boolean(),
  reason: z.string(),
});

export const grantRowSchema = z.object({
  createdAt: z.number(),
  email: z.string(),
  expiresAt: z.number().nullable(),
  id: z.string(),
  quantity: z.number(),
  source: z.string(),
  startsAt: z.number(),
});

export const grantsResponseSchema = z.object({ grants: z.array(grantRowSchema) });

const marginPlanRowSchema = z.object({
  plan: z.enum(["trial", "week", "month"]),
  priceMicros: z.number(),
  applications: z.number(),
  users: z.number(),
  completed: z.number(),
  costMicrosPerCompleted: z.number().nullable(),
  revenueMicrosPerApplication: z.number(),
  stripeFeeMicrosPerApplication: z.number(),
  netRevenueMicrosPerApplication: z.number(),
  internationalNetRevenueMicrosPerApplication: z.number(),
  marginMicrosPerApplication: z.number().nullable(),
  marginRatio: z.number().nullable(),
  costGateMet: z.boolean().nullable(),
});

export const marginResponseSchema = z.object({
  windowDays: z.number(),
  generatedAt: z.number(),
  costGateMicros: z.number(),
  completed: z.number(),
  costMicrosPerCompleted: z.number().nullable(),
  browserMicrosPerCompleted: z.number().nullable(),
  anthropicMicrosPerCompleted: z.number().nullable(),
  stripe: z.object({
    domesticRate: z.number(),
    fixedFeeMicros: z.number(),
    internationalRate: z.number(),
  }),
  plans: z.array(marginPlanRowSchema),
  beside: z.object({
    fixedInfraMicrosPerMonth: z.number(),
    mail: z.object({
      month: z.string(),
      sends: z.number(),
      includedSends: z.number(),
      overageMicros: z.number(),
    }),
    otherAnthropicMicros: z.number(),
  }),
});

export const grantCreateResponseSchema = z.object({
  applicationsLeft: z.number(),
  grantId: z.string(),
});

export const adminStatusSchema = z.enum(["all", "active", "suspended", "invited"]);

export const adminGrantViewSchema = z.object({
  expiresAt: z.number().nullable(),
  quantity: z.number(),
  startsAt: z.number(),
});

export const adminPersonRowSchema = z.object({
  acceptedAt: z.number().nullable(),
  createdAt: z.number(),
  email: z.string().nullable(),
  grant: adminGrantViewSchema.nullable(),
  grantsLeft: z.number().nullable(),
  id: z.string(),
  inviteAt: z.number().nullable(),
  kind: z.enum(["user", "invite"]),
  lastActiveAt: z.number().nullable(),
  name: z.string().nullable(),
  online: z.boolean().default(false),
  signedIn: z.boolean().default(false),
  status: z.enum(["active", "suspended", "invited"]),
});

export const adminUsersResponseSchema = z.object({
  counts: z.object({
    active: z.number(),
    all: z.number(),
    invited: z.number(),
    suspended: z.number(),
  }),
  now: z.number(),
  onlineNow: z.number().default(0),
  page: z.number(),
  pageSize: z.number(),
  rows: z.array(adminPersonRowSchema),
  signedInNow: z.number().default(0),
  total: z.number(),
});

export const adminUserDetailSchema = z.object({
  now: z.number(),
  user: z.object({
    acceptedAt: z.number().nullable(),
    applicationsLeft: z.number(),
    createdAt: z.number(),
    email: z.string(),
    emailVerified: z.boolean(),
    forwardingAddress: z.string().nullable(),
    grant: z
      .object({
        expiresAt: z.number().nullable(),
        quantity: z.number(),
        remaining: z.number(),
        startsAt: z.number(),
        used: z.number(),
      })
      .nullable(),
    id: z.string(),
    inviteAt: z.number().nullable(),
    lastActiveAt: z.number().nullable(),
    name: z.string(),
    resume: z
      .object({
        filename: z.string().nullable(),
        uploadedAt: z.number(),
      })
      .nullable(),
    role: z.string(),
    stats: z.object({
      couldNotApply: z.number(),
      readyToSend: z.number(),
      reviewsOpen: z.number(),
      sentThisWeek: z.number(),
    }),
    status: z.enum(["active", "suspended"]),
    suspendedAt: z.number().nullable(),
    targets: z
      .object({
        locations: z.array(z.string()),
        roles: z.array(z.string()),
      })
      .nullable(),
  }),
});

export const adminSessionSchema = z.object({
  now: z.number(),
  owner: z.object({ email: z.string(), name: z.string() }),
});

export const adminSuspendResponseSchema = z.object({
  id: z.string(),
  suspendedAt: z.number().nullable(),
});

export const inviteRowSchema = z.object({
  acceptedAt: z.number().nullable(),
  acceptedUserId: z.string().nullable(),
  createdAt: z.number(),
  email: z.string().nullable(),
  grant: adminGrantViewSchema.nullable(),
  grantId: z.string().nullable(),
  id: z.string(),
  invitedBy: z.string().nullable(),
  revokedAt: z.number().nullable(),
  status: z.enum(["accepted", "pending", "revoked"]),
});

export const invitesResponseSchema = z.object({
  grant: z.object({ days: z.number(), quantity: z.number() }),
  invites: z.array(inviteRowSchema),
});

export type InvitesResponse = z.infer<typeof invitesResponseSchema>;

export const inviteCreateResponseSchema = z.object({ invite: inviteRowSchema });

export const catalogResponseSchema = z.object({
  discoveredAt: z.number().nullable(),
  manifestVersion: z.string().nullable().default(null),
  tagging: taggingReportSchema.nullable().default(null),
  ats: z.array(
    z.object({
      ats: z.string(),
      hourlyLimit: z.number().nullable(),
      killSwitchEnabled: z.boolean().nullable(),
    }),
  ),
});

export const personioProbeFormSchema = z.object({
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

export const personioProbeSummarySchema = z.object({
  total: z.number(),
  readable: z.number(),
  needsReview: z.number(),
  unreadable: z.number(),
  unsupported: z.number(),
  passed: z.boolean(),
});

export const personioProbeSchema = z.object({
  ranAt: z.number().nullable(),
  summary: personioProbeSummarySchema.nullable(),
  forms: z.array(personioProbeFormSchema),
});

export const probeQueuedSchema = z.object({ jobId: z.string() });

export const mailAuthCountsSchema = z.object({
  fail: z.number(),
  none: z.number(),
  pass: z.number(),
});

export const mailHealthStatusSchema = z.enum(["healthy", "reply_alert", "too_few_sends", "watch"]);

export const mailHealthEmployerSchema = z.object({
  applications: z.number(),
  ats: z.array(z.string()),
  auth: mailAuthCountsSchema,
  bounces: z.number(),
  companyId: z.string(),
  employer: z.string(),
  killSwitch: z
    .object({
      enabled: z.boolean(),
      reason: z.string(),
    })
    .nullable(),
  replies: z.number(),
  replyRate: z.number().nullable(),
  sent: z.number(),
  status: mailHealthStatusSchema,
});

export const mailHealthSchema = z.object({
  alerts: z.array(
    z.object({
      companyId: z.string(),
      employer: z.string(),
      replies: z.number(),
      sent: z.number(),
    }),
  ),
  days: z.number(),
  domainAlert: z.object({
    active: z.boolean(),
    replies: z.number(),
    replyRate: z.number().nullable(),
    sent: z.number(),
  }),
  employers: z.array(mailHealthEmployerSchema),
  since: z.number(),
  totals: z.object({
    auth: mailAuthCountsSchema,
    bounces: z.number(),
    replies: z.number(),
    sent: z.number(),
  }),
});

export type AdminRefusalCode = z.infer<typeof adminRefusalCodeSchema>;

export const supportCategorySchema = z.enum(["account", "billing", "bug", "other"]);

export const supportTicketStatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);

export const supportStatusFilterSchema = z.enum([
  "open",
  "in_progress",
  "resolved",
  "closed",
  "all",
]);

export const adminSupportTicketSchema = z.object({
  adminNotes: z.string().nullable(),
  category: supportCategorySchema,
  createdAt: z.number(),
  id: z.string(),
  message: z.string().nullable(),
  referenceId: z.string(),
  resolvedAt: z.number().nullable(),
  status: supportTicketStatusSchema,
  subject: z.string(),
  updatedAt: z.number(),
  userEmail: z.string(),
  userId: z.string(),
  userName: z.string(),
});

export const adminSupportResponseSchema = z.object({
  items: z.array(adminSupportTicketSchema),
  now: z.number(),
  openCount: z.number(),
  total: z.number(),
});

export const adminSupportTicketResponseSchema = z.object({ ticket: adminSupportTicketSchema });

export const adminSupportReplyResponseSchema = z.object({
  ok: z.literal(true),
  referenceId: z.string(),
});

export type SupportCategory = z.infer<typeof supportCategorySchema>;

export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

export type SupportStatusFilter = z.infer<typeof supportStatusFilterSchema>;

export type AdminSupportTicket = z.infer<typeof adminSupportTicketSchema>;

export type AdminSupportResponse = z.infer<typeof adminSupportResponseSchema>;

export type AdminStatus = z.infer<typeof adminStatusSchema>;

export type AdminPersonRow = z.infer<typeof adminPersonRowSchema>;

export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

export type AdminSession = z.infer<typeof adminSessionSchema>;

export type InviteRow = z.infer<typeof inviteRowSchema>;

export type Overview = z.infer<typeof overviewSchema>;

export type ProviderReport = z.infer<typeof providerReportSchema>;

export type ProviderReportRow = z.infer<typeof providerReportRowSchema>;

export type LabReportRow = z.infer<typeof labReportRowSchema>;

export type AuditRow = z.infer<typeof auditRowSchema>;

export type AdminAuditPage = z.infer<typeof adminAuditPageSchema>;

export type AdminAlertProblem = z.infer<typeof adminAlertProblemSchema>;

export type AdminAlertNotification = z.infer<typeof adminAlertNotificationSchema>;

export type LaunchReadiness = z.infer<typeof launchReadinessSchema>;

export type AdminAlertsResponse = z.infer<typeof adminAlertsResponseSchema>;

export type KillSwitchRow = z.infer<typeof killSwitchRowSchema>;

export type GrantRow = z.infer<typeof grantRowSchema>;

export const systemDatabaseSizesSchema = z.object({
  fileBytes: z.number(),
  freeBytes: z.number(),
  freelistCount: z.number(),
  pageCount: z.number(),
  pageSize: z.number(),
  walBytes: z.number(),
});

export const backupReplicationSchema = z.discriminatedUnion("replication", [
  z.object({ replication: z.literal("unconfigured") }),
  z.object({ readAgeSeconds: z.number().nullable(), replication: z.literal("unknown") }),
  z.object({ readAgeSeconds: z.number(), replication: z.literal("unavailable") }),
  z.object({
    lagSeconds: z.number(),
    readAgeSeconds: z.number(),
    replicaTxid: z.string(),
    replication: z.literal("ok"),
  }),
]);

export const degradedFlagSchema = z.object({
  degraded: z.literal(true),
  metrics: z.array(
    z.object({
      allowance: z.number(),
      metric: z.string(),
      share: z.number(),
      used: z.number(),
    }),
  ),
  since: z.string(),
  version: z.literal(1),
});

export const liveCheckResultSchema = z.object({
  check: z.string(),
  detail: z.looseObject({ error: z.string().optional(), skipped: z.string().optional() }),
  durationMs: z.number(),
  id: z.string(),
  ok: z.boolean(),
  runId: z.string(),
  startedAt: z.number(),
});

export const systemReportSchema = z.object({
  backups: backupReplicationSchema,
  catalog: z.object({
    boards: z.number(),
    bySource: z.array(z.object({ closed: z.number(), open: z.number(), source: z.string() })),
    closedPostings: z.number(),
    lastPolledAt: z.number().nullable(),
    lastSeenAt: z.number().nullable(),
    openPostings: z.number(),
  }),
  databases: z.object({
    app: systemDatabaseSizesSchema.nullable(),
    catalog: systemDatabaseSizesSchema.nullable(),
  }),
  degraded: degradedFlagSchema.nullable(),
  generatedAt: z.number(),
  integrations: z.object({
    browserProvider: z.enum(["browser_use", "kernel", "local"]).nullable(),
    cfAccessConfigured: z.boolean(),
    cloudflareEmailConfigured: z.boolean(),
    demoLoginEnabled: z.boolean(),
    ntfyConfigured: z.boolean(),
    publicSignupEnabled: z.boolean(),
    stripeMode: z.enum(["live", "test", "unconfigured"]),
    turnstileConfigured: z.boolean(),
  }),
  liveChecks: z.object({
    latestRunAt: z.number().nullable(),
    results: z.array(liveCheckResultSchema),
  }),
  runtime: z.object({
    bunVersion: z.string(),
    heapTotalBytes: z.number(),
    heapUsedBytes: z.number(),
    loadAverage: z.tuple([z.number(), z.number(), z.number()]),
    rssBytes: z.number(),
    uptimeSeconds: z.number(),
  }),
  volume: z
    .object({
      freeBytes: z.number(),
      mount: z.string(),
      totalBytes: z.number(),
      usedRatio: z.number(),
    })
    .nullable(),
});

export const systemCheckpointSchema = z.object({
  afterWalBytes: z.number(),
  beforeWalBytes: z.number(),
  busy: z.number(),
  checkpointed: z.number(),
});

export const liveChecksRunSchema = z.object({ jobId: z.string() });

export type SystemReport = z.infer<typeof systemReportSchema>;

export type SystemCheckpoint = z.infer<typeof systemCheckpointSchema>;

export type LiveCheckResult = z.infer<typeof liveCheckResultSchema>;

export type MailHealth = z.infer<typeof mailHealthSchema>;

export type MailHealthEmployer = z.infer<typeof mailHealthEmployerSchema>;

export type AdminResult<T> = { ok: true; data: T } | { ok: false; refusal: AdminRefusalCode };

const refusalBodySchema = z.object({
  error: adminRefusalCodeSchema,
});

export class AdminHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The admin request did not go through (${String(status)}).`);
    this.name = "AdminHttpError";
    this.status = status;
  }
}

async function adminRequest<T>(response: Response, schema: z.ZodType<T>) {
  const raw: unknown = await response.json();
  const refusal = refusalBodySchema.safeParse(raw);

  if (!response.ok && refusal.success) {
    const denied: AdminResult<T> = { ok: false, refusal: refusal.data.error };

    return denied;
  }

  if (!response.ok) {
    throw new AdminHttpError(response.status);
  }

  const loaded: AdminResult<T> = { ok: true, data: schema.parse(raw) };

  return loaded;
}

async function adminGet<T>(path: string, schema: z.ZodType<T>) {
  return adminRequest(await fetch(path), schema);
}

type AdminWriteBody =
  | {
      enabled: boolean;
      reason: string;
    }
  | {
      email: string;
      expiresInDays: number | null;
      idempotencyKey: string;
      quantity: number;
    }
  | {
      amountCents: number | null;
      grantId: string;
      idempotencyKey: string;
      note: string;
      reason: string;
    }
  | { email: string }
  | { reason: string }
  | { value: string }
  | { providers: string[]; pages: string[]; sessionsPerPage: number }
  | { urls?: string[] }
  | { status: SupportTicketStatus; adminNotes?: string }
  | { message: string }
  | { id?: string };

async function adminWrite<T>(
  method: "POST" | "PUT" | "PATCH",
  path: string,
  body: AdminWriteBody | null,
  schema: z.ZodType<T>,
) {
  const init: RequestInit = { method };

  if (body !== null) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }

  const response = await fetch(path, init);

  const result = await adminRequest(response, schema);

  if (!result.ok) {
    throw new Error(`The admin change was refused (${result.refusal}).`);
  }

  return result.data;
}

async function adminPost<T>(path: string, body: AdminWriteBody | null, schema: z.ZodType<T>) {
  return adminWrite("POST", path, body, schema);
}

async function adminPut<T>(path: string, body: AdminWriteBody, schema: z.ZodType<T>) {
  return adminWrite("PUT", path, body, schema);
}

export const loadOverview = async () => adminGet("/admin/api/overview", overviewSchema);

export const loadAdminAlerts = async () => adminGet("/admin/api/alerts", adminAlertsResponseSchema);

export const ackAdminAlerts = async (id?: string) =>
  adminPost("/admin/api/alerts/ack", id === undefined ? {} : { id }, ackAlertsResponseSchema);

export interface AdminAuditFilterInput {
  action?: string;
  actorId?: string;
  targetUserId?: string;
  q?: string;
  limit?: number;
  before?: string | null;
}

export const loadAdminAudit = async (input: AdminAuditFilterInput) => {
  const search = new URLSearchParams();

  if (input.action !== undefined && input.action.trim().length > 0) {
    search.set("action", input.action.trim());
  }

  if (input.actorId !== undefined && input.actorId.trim().length > 0) {
    search.set("actorId", input.actorId.trim());
  }

  if (input.targetUserId !== undefined && input.targetUserId.trim().length > 0) {
    search.set("targetUserId", input.targetUserId.trim());
  }

  if (input.q !== undefined && input.q.trim().length > 0) {
    search.set("q", input.q.trim());
  }

  if (input.limit !== undefined) {
    search.set("limit", String(input.limit));
  }

  if (input.before !== undefined && input.before !== null && input.before.trim().length > 0) {
    search.set("before", input.before.trim());
  }

  const query = search.toString();
  const path = query.length === 0 ? "/admin/api/audit" : `/admin/api/audit?${query}`;

  return adminGet(path, adminAuditPageSchema);
};

export const loadAdminSupport = async (input: { status: SupportStatusFilter; limit?: number }) => {
  const search = new URLSearchParams({ status: input.status });

  if (input.limit !== undefined) {
    search.set("limit", String(input.limit));
  }

  return adminGet(`/admin/api/support?${search.toString()}`, adminSupportResponseSchema);
};

export const updateSupportTicket = async (
  id: string,
  body: { status: SupportTicketStatus; adminNotes?: string },
) =>
  adminWrite(
    "PATCH",
    `/admin/api/support/${encodeURIComponent(id)}`,
    body,
    adminSupportTicketResponseSchema,
  );

export const replyToSupportTicket = async (id: string, message: string) =>
  adminPost(
    `/admin/api/support/${encodeURIComponent(id)}/reply`,
    { message },
    adminSupportReplyResponseSchema,
  );

export const loadApplicationLookup = async (applicationId: string) =>
  adminGet(
    `/admin/api/applications/${encodeURIComponent(applicationId)}/lookup`,
    applicationLookupSchema,
  );

export const loadSettings = async () => adminGet("/admin/api/settings", settingsResponseSchema);

export const loadJobs = async (input: { status: JobStatusFilter; kind: string; limit: number }) => {
  const search = new URLSearchParams({
    limit: String(input.limit),
    status: input.status,
  });

  if (input.kind.length > 0) {
    search.set("kind", input.kind);
  }

  return adminGet(`/admin/api/jobs?${search.toString()}`, jobsResponseSchema);
};

export const retryJob = async (id: string) =>
  adminPost(`/admin/api/jobs/${encodeURIComponent(id)}/retry`, null, jobActionResponseSchema);

export const cancelJob = async (id: string) =>
  adminPost(`/admin/api/jobs/${encodeURIComponent(id)}/cancel`, null, jobActionResponseSchema);

export const loadProviderReport = async () =>
  adminGet("/admin/api/provider-report", providerReportSchema);

export const runLab = async (providers: string[], pages: string[], sessionsPerPage: number) =>
  adminPost("/admin/api/lab/runs", { pages, providers, sessionsPerPage }, labRunResponseSchema);

export const loadKillSwitches = async () =>
  adminGet("/admin/api/kill-switches", killSwitchesResponseSchema);

export const loadCatalog = async () => adminGet("/admin/api/catalog", catalogResponseSchema);

export const loadPersonioProbe = async () =>
  adminGet("/admin/api/probes/personio", personioProbeSchema);

export const runPersonioProbe = async (urls?: string[]) =>
  adminPost("/admin/api/probes/personio", urls === undefined ? {} : { urls }, probeQueuedSchema);

export const loadMailHealth = async (days: number) =>
  adminGet(`/admin/api/mail-health?days=${String(days)}`, mailHealthSchema);

export const loadSystem = async () => adminGet("/admin/api/system", systemReportSchema);

export const runWalCheckpoint = async () =>
  adminPost("/admin/api/system/checkpoint", null, systemCheckpointSchema);

export const runLiveChecksNow = async () =>
  adminPost("/admin/api/live-checks/run", null, liveChecksRunSchema);

export const saveSetting = async (settingKey: string, value: string) =>
  adminPut(`/admin/api/settings/${settingKey}`, { value }, settingResponseSchema);

export const setKillSwitch = async (scope: string, key: string, enabled: boolean, reason: string) =>
  adminPut(
    `/admin/api/kill-switches/${scope}/${key}`,
    { enabled, reason },
    killSwitchResponseSchema,
  );

export const loadGrants = async () => adminGet("/admin/api/grants", grantsResponseSchema);

export type MarginReport = z.infer<typeof marginResponseSchema>;

export type MarginPlanRow = z.infer<typeof marginPlanRowSchema>;

export const loadMargin = async () => adminGet("/admin/api/margin", marginResponseSchema);
export const billingStateSchema = z.enum(["trial", "paying", "ending", "paused", "ended", "none"]);

export const billingPlanSchema = z.enum(["week", "month"]);

export const billingUserRowSchema = z.object({
  email: z.string(),
  expiresAt: z.number().nullable(),
  id: z.string(),
  name: z.string(),
  plan: billingPlanSchema.nullable(),
  refunded: z.boolean(),
  state: billingStateSchema,
  usage: z.object({ left: z.number(), quantity: z.number(), used: z.number() }).nullable(),
});

export const billingUsersResponseSchema = z.object({
  counts: z.object({
    endingSoon: z.number(),
    onTrial: z.number(),
    paused: z.number(),
    paying: z.number(),
  }),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  users: z.array(billingUserRowSchema),
});

export const billingPeriodSchema = z.object({
  expiresAt: z.number().nullable(),
  grantId: z.string(),
  left: z.number(),
  plan: billingPlanSchema,
  quantity: z.number(),
  refunded: z.boolean(),
  source: z.enum(["trial", "period", "admin"]),
  startsAt: z.number(),
  used: z.number(),
});

export const billingUserViewSchema = z.object({
  current: billingPeriodSchema.nullable(),
  email: z.string(),
  id: z.string(),
  name: z.string(),
  paused: z.boolean(),
  pausedReason: z.literal("payment_failed").nullable(),
  periods: z.array(billingPeriodSchema),
  refundable: z.boolean(),
  state: billingStateSchema,
  trial: billingPeriodSchema.nullable(),
});

export const billingUserResponseSchema = z.object({ user: billingUserViewSchema });

export const billingMismatchKindSchema = z.enum([
  "invoice_without_grant",
  "grant_without_invoice",
  "refund_without_ledger",
  "ledger_without_refund",
  "refund_ledger_missing",
]);

export const billingMismatchSchema = z.object({
  amountCents: z.number().nullable(),
  id: z.string(),
  kind: billingMismatchKindSchema,
});

export const billingReconciliationItemSchema = z.object({
  amountCents: z.number().nullable(),
  id: z.string(),
  owner: z.object({ email: z.string(), name: z.string() }).nullable(),
  result: z.enum(["matched", "not_in_overture", "not_in_stripe"]),
});

export const billingReconciliationSchema = z.object({
  checkedAt: z.number(),
  day: z.string(),
  items: z.array(billingReconciliationItemSchema),
  itemsTotal: z.number(),
  ledgerGrants: z.number(),
  ledgerRefunds: z.number(),
  matched: z.number(),
  mismatchTotal: z.number(),
  mismatches: z.array(billingMismatchSchema),
  unrecorded: z.number(),
  status: z.enum(["clean", "mismatch"]),
  stripeInvoices: z.number(),
  stripeRefunds: z.number(),
  windowEnd: z.number(),
  windowStart: z.number(),
});

export const billingReconciliationResponseSchema = z.object({
  reconciliation: billingReconciliationSchema.nullable(),
});

export const refundResponseSchema = z.object({
  refund: z.object({
    amountCents: z.number(),
    applicationsStopped: z.number(),
    grantId: z.string(),
    refundId: z.string(),
    status: z.string(),
  }),
  replayed: z.boolean(),
});

export type BillingUserRow = z.infer<typeof billingUserRowSchema>;

export type BillingUsersResponse = z.infer<typeof billingUsersResponseSchema>;

export type BillingUserView = z.infer<typeof billingUserViewSchema>;

export type BillingPeriod = z.infer<typeof billingPeriodSchema>;

export type BillingFilter = "all" | "trial" | "paying" | "paused" | "ended";

export type BillingReconciliation = z.infer<typeof billingReconciliationSchema>;

export type BillingMismatch = z.infer<typeof billingMismatchSchema>;

export type BillingReconciliationItem = z.infer<typeof billingReconciliationItemSchema>;

export type BillingMismatchKind = z.infer<typeof billingMismatchKindSchema>;

export const loadBillingUsers = async (filter: BillingFilter, page: number) =>
  adminGet(
    `/admin/api/billing/users?filter=${filter}&page=${String(page)}`,
    billingUsersResponseSchema,
  );

export const loadBillingReconciliation = async () =>
  adminGet("/admin/api/billing/reconciliation", billingReconciliationResponseSchema);

export const loadBillingUser = async (userId: string) =>
  adminGet(`/admin/api/billing/users/${encodeURIComponent(userId)}`, billingUserResponseSchema);

export const postRefund = async (body: {
  amountCents: number | null;
  grantId: string;
  idempotencyKey: string;
  note: string;
  reason: string;
}) => adminPost("/admin/api/billing/refunds", body, refundResponseSchema);

export const createGrant = async (
  email: string,
  quantity: number,
  expiresInDays: number | null,
  idempotencyKey: string,
) =>
  adminPost(
    "/admin/api/grants",
    { email, expiresInDays, idempotencyKey, quantity },
    grantCreateResponseSchema,
  );

export const loadUsers = async (input: { page: number; q: string; status: AdminStatus }) => {
  const search = new URLSearchParams({
    page: String(input.page),
    q: input.q,
    status: input.status,
  });

  return adminGet(`/admin/api/users?${search.toString()}`, adminUsersResponseSchema);
};

export const loadUser = async (id: string) =>
  adminGet(`/admin/api/users/${encodeURIComponent(id)}`, adminUserDetailSchema);

export const adminDashboardsSchema = z.object({
  links: z.array(
    z.object({
      group: z.enum(["metrics", "edge", "spend"]),
      href: z.url(),
      id: z.string(),
    }),
  ),
  now: z.number(),
  onlineNow: z.number(),
  signedInNow: z.number(),
});

export type AdminDashboards = z.infer<typeof adminDashboardsSchema>;

export const loadDashboards = async () => adminGet("/admin/api/dashboards", adminDashboardsSchema);

export const loadAdminSession = async () => adminGet("/admin/api/session", adminSessionSchema);

export const loadInvites = async () => adminGet("/admin/api/invites", invitesResponseSchema);

export type WaitlistResponse = z.infer<typeof waitlistResponseSchema>;

export const loadWaitlist = async (input: {
  status: "all" | "pending" | "invited" | "joined";
  q: string;
  order: "newest" | "oldest";
}) => {
  const search = new URLSearchParams({
    order: input.order,
    q: input.q,
    status: input.status,
  });

  return adminGet(`/admin/api/waitlist?${search.toString()}`, waitlistResponseSchema);
};

export const inviteWaitlistEntry = async (id: string) =>
  adminPost(
    `/admin/api/waitlist/${encodeURIComponent(id)}/invite`,
    null,
    waitlistInviteResponseSchema,
  );

export const createInvite = async (email: string) =>
  adminPost("/admin/api/invites", { email }, inviteCreateResponseSchema);

export const revokeInvite = async (id: string) =>
  adminPost(
    `/admin/api/invites/${encodeURIComponent(id)}/revoke`,
    null,
    inviteCreateResponseSchema,
  );

export const suspendUser = async (id: string, reason: string) =>
  adminPost(
    `/admin/api/users/${encodeURIComponent(id)}/suspend`,
    { reason },
    adminSuspendResponseSchema,
  );

export const reinstateUser = async (id: string, reason: string) =>
  adminPost(
    `/admin/api/users/${encodeURIComponent(id)}/reinstate`,
    { reason },
    adminSuspendResponseSchema,
  );

export const attemptOutcomeFilterSchema = z.enum([
  "all",
  "completed",
  "challenge_blocked",
  "error",
  "timeout",
]);

export const attemptProviderSchema = z.enum(["browser_use", "kernel", "local"]);

export const attemptOutcomeSchema = z.enum([
  "sent",
  "unconfirmed",
  "captcha_blocked",
  "code_timeout",
  "posting_closed",
  "form_changed",
  "blocked",
  "upload_failed",
  "duplicate",
  "identity_mismatch",
  "needs_review",
  "provider_error",
  "timeout",
  "crash",
  "interrupted",
]);

const insightActivitySchema = z.object({
  at: z.number(),
  detail: z.string(),
  kind: z.enum([
    "admin",
    "application",
    "attempt",
    "grant",
    "onboarded",
    "resume",
    "signed_in",
    "subscription",
    "targets",
  ]),
});

export const adminUserInsightSchema = z.object({
  insight: z.object({
    applications: z.record(z.string(), z.number()),
    attempts: z.array(
      z.object({
        applicationId: z.string(),
        browserMs: z.number().nullable(),
        company: z.string(),
        costMicros: z.number().nullable(),
        endedAt: z.number().nullable(),
        errorCode: z.string().nullable(),
        id: z.string(),
        outcome: attemptOutcomeSchema.nullable(),
        provider: z.string(),
        providerSessionId: z.string().nullable(),
        startedAt: z.number(),
        title: z.string(),
      }),
    ),
    credits: z.object({ available: z.number(), reserved: z.number(), used: z.number() }),
    onboarding: z.object({
      onboardedAt: z.number().nullable(),
      pauseReason: z.string().nullable(),
      running: z.boolean(),
      step: z.number(),
    }),
    presence: z.object({
      lastSeenAt: z.number().nullable(),
      lastSignInAt: z.number().nullable(),
      online: z.boolean(),
      signedInSessions: z.number(),
    }),
    queue: z.object({
      scored: z.number(),
      top: z.array(
        z.object({
          codeRank: z.number(),
          company: z.string().nullable(),
          location: z.string().nullable(),
          open: z.boolean(),
          postingId: z.string(),
          score: z.number().nullable(),
          scoredAt: z.number().nullable(),
          title: z.string().nullable(),
        }),
      ),
      total: z.number(),
    }),
    spend: z.object({
      browser: z.array(
        z.object({
          attempts: z.number(),
          browserMs: z.number(),
          costMicros: z.number(),
          provider: z.string(),
        }),
      ),
      browserMicros: z.number(),
      llm: z.array(z.object({ calls: z.number(), costMicros: z.number(), purpose: z.string() })),
      llmMicros: z.number(),
      totalMicros: z.number(),
    }),
    timeline: z.array(insightActivitySchema),
  }),
  now: z.number(),
});

export type AdminUserInsight = z.infer<typeof adminUserInsightSchema>["insight"];

export const loadUserInsight = async (id: string) =>
  adminGet(`/admin/api/users/${encodeURIComponent(id)}/insight`, adminUserInsightSchema);

export const attemptRowSchema = z.object({
  applicationId: z.string(),
  ats: z.string().nullable(),
  browserMs: z.number().nullable(),
  captchaSeen: z.boolean(),
  codeUsed: z.boolean(),
  companyName: z.string(),
  costMicros: z.number().nullable(),
  endedAt: z.number().nullable(),
  errorCode: z.string().nullable(),
  id: z.string(),
  liveUrl: z.string(),
  outcome: attemptOutcomeSchema.nullable(),
  postingTitle: z.string(),
  provider: attemptProviderSchema,
  providerSessionId: z.string().nullable(),
  proxyBytes: z.number().nullable(),
  replayUrl: z.string(),
  startedAt: z.number(),
});

export const attemptsCountsSchema = z.object({
  active: z.number(),
  all: z.number(),
  challenge_blocked: z.number(),
  completed: z.number(),
  error: z.number(),
  timeout: z.number(),
});

export const attemptsResponseSchema = z.object({
  attempts: z.array(attemptRowSchema),
  counts: attemptsCountsSchema,
  now: z.number(),
});

export const attemptLiveSchema = z.object({
  liveViewUrl: z.string().nullable(),
  recordingUrl: z.string().nullable(),
  status: z.enum(["active", "stopped"]),
});

export const attemptReplaySchema = z.object({
  recordingUrl: z.string(),
});

const attemptUnavailableBodySchema = z.object({
  error: z.enum(["not_found", "provider_unavailable"]),
});

export const llmUsageTotalsSchema = z.object({
  cachedTokens: z.number(),
  calls: z.number(),
  costMicros: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const llmUsageRowSchema = z.object({
  cachedTokens: z.number(),
  costMicros: z.number(),
  createdAt: z.number(),
  id: z.string(),
  inputTokens: z.number(),
  model: z.string(),
  outputTokens: z.number(),
  purpose: z.string(),
  userId: z.string().nullable(),
});

export const llmUsagePurposeRowSchema = llmUsageTotalsSchema.extend({
  purpose: z.string(),
});

export const llmUsageModelRowSchema = llmUsageTotalsSchema.extend({
  model: z.string(),
  unexpected: z.boolean(),
});

export const llmUsageCapsSchema = z.object({
  dailySpendCapMicros: z.number(),
  baseDailySpendCapMicros: z.number(),
  perSubscriberDayMicros: z.number(),
  subscribers: z.number(),
  monthlySpendCapMicros: z.number().nullable(),
  taggingDailyCapMicros: z.number(),
  userDailyCapMicros: z.number(),
});

export const llmUsageResponseSchema = z.object({
  allTime: llmUsageTotalsSchema,
  byModel: z.array(llmUsageModelRowSchema),
  byPurpose: z.array(llmUsagePurposeRowSchema),
  caps: llmUsageCapsSchema,
  expectedModel: z.string(),
  month: llmUsageTotalsSchema,
  now: z.number(),
  rows: z.array(llmUsageRowSchema),
  today: llmUsageTotalsSchema,
  totals: llmUsageTotalsSchema,
});

export type AttemptOutcomeFilter = z.infer<typeof attemptOutcomeFilterSchema>;

export type AttemptOutcome = z.infer<typeof attemptOutcomeSchema>;

export type AttemptRow = z.infer<typeof attemptRowSchema>;

export type AttemptsCounts = z.infer<typeof attemptsCountsSchema>;

export type AttemptsResponse = z.infer<typeof attemptsResponseSchema>;

export type AttemptLive = z.infer<typeof attemptLiveSchema>;

export type AttemptReplay = z.infer<typeof attemptReplaySchema>;

export type AttemptViewResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: AdminRefusalCode }
  | { ok: false; unavailable: "not_found" | "provider_unavailable" };

export type LlmUsageTotals = z.infer<typeof llmUsageTotalsSchema>;

export type LlmUsageRow = z.infer<typeof llmUsageRowSchema>;

export type LlmUsagePurposeRow = z.infer<typeof llmUsagePurposeRowSchema>;

export type LlmUsageModelRow = z.infer<typeof llmUsageModelRowSchema>;

export type LlmUsageCaps = z.infer<typeof llmUsageCapsSchema>;

export type LlmUsageResponse = z.infer<typeof llmUsageResponseSchema>;

async function adminOptionalView<T>(path: string, schema: z.ZodType<T>) {
  const response = await fetch(path);
  const raw: unknown = await response.json();
  const refusal = refusalBodySchema.safeParse(raw);

  if (!response.ok && refusal.success) {
    const denied: AttemptViewResult<T> = { ok: false, refusal: refusal.data.error };

    return denied;
  }

  const unavailable = attemptUnavailableBodySchema.safeParse(raw);

  if (response.status === 404 && unavailable.success) {
    const missing: AttemptViewResult<T> = { ok: false, unavailable: unavailable.data.error };

    return missing;
  }

  if (!response.ok) {
    throw new Error(`The admin request did not go through (${String(response.status)}).`);
  }

  const loaded: AttemptViewResult<T> = { ok: true, data: schema.parse(raw) };

  return loaded;
}

export const fetchAdminAttempts = async (
  input: {
    applicationId?: string | undefined;
    limit?: number | undefined;
    outcome?: AttemptOutcomeFilter | undefined;
  } = {},
) => {
  const search = new URLSearchParams();

  if (input.applicationId !== undefined && input.applicationId.trim().length > 0) {
    search.set("applicationId", input.applicationId.trim());
  }

  if (input.outcome !== undefined && input.outcome !== "all") {
    search.set("outcome", input.outcome);
  }

  if (input.limit !== undefined) {
    search.set("limit", String(input.limit));
  }

  const query = search.toString();

  return adminGet(
    query.length === 0 ? "/admin/api/attempts" : `/admin/api/attempts?${query}`,
    attemptsResponseSchema,
  );
};

export const fetchAdminAttemptLive = async (id: string) =>
  adminOptionalView(`/admin/api/attempts/${encodeURIComponent(id)}/live`, attemptLiveSchema);

export const fetchAdminAttemptReplay = async (id: string) =>
  adminOptionalView(`/admin/api/attempts/${encodeURIComponent(id)}/replay`, attemptReplaySchema);

export const fetchAdminLlmUsage = async (
  input: { limit?: number | undefined; purpose?: string | undefined } = {},
) => {
  const search = new URLSearchParams();

  if (input.purpose !== undefined && input.purpose.trim().length > 0) {
    search.set("purpose", input.purpose.trim());
  }

  if (input.limit !== undefined) {
    search.set("limit", String(input.limit));
  }

  const query = search.toString();

  return adminGet(
    query.length === 0 ? "/admin/api/llm-usage" : `/admin/api/llm-usage?${query}`,
    llmUsageResponseSchema,
  );
};
