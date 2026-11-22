import { z } from "zod";

export const adminRefusalCodeSchema = z.enum([
  "access_required",
  "sign_in_required",
  "owner_required",
  "passkey_required",
]);

export const auditRowSchema = z.object({
  id: z.string(),
  at: z.number(),
  actorId: z.string(),
  action: z.string(),
  targetUserId: z.string().nullable(),
  reason: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const overviewSchema = z.object({
  now: z.number(),
  jobs: z.record(z.string(), z.number()),
  users: z.object({ total: z.number(), owners: z.number() }),
  sessions: z.number(),
  killSwitches: z.object({ total: z.number(), enabled: z.number() }),
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
  }),
  audit: z.array(auditRowSchema),
});

export const providerReportRowSchema = z.object({
  ats: z.string(),
  attempted: z.number(),
  challengeRate: z.number().nullable(),
  codeRate: z.number().nullable(),
  completionRate: z.number().nullable(),
  costGateMet: z.boolean().nullable(),
  costGateMicros: z.number(),
  costMicrosPerCompleted: z.number().nullable(),
  p50BrowserMs: z.number().nullable(),
  p95BrowserMs: z.number().nullable(),
  provider: z.string(),
  proxyMbPerCompleted: z.number().nullable(),
  proxyTrend: z.boolean(),
  sent: z.number(),
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
  page: z.number(),
  pageSize: z.number(),
  rows: z.array(adminPersonRowSchema),
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
  passkeyAssertedAt: z.number().nullable(),
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
  ats: z.array(
    z.object({
      ats: z.string(),
      hourlyLimit: z.number().nullable(),
      killSwitchEnabled: z.boolean().nullable(),
    }),
  ),
});

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

export type KillSwitchRow = z.infer<typeof killSwitchRowSchema>;

export type GrantRow = z.infer<typeof grantRowSchema>;

export type MailHealth = z.infer<typeof mailHealthSchema>;

export type MailHealthEmployer = z.infer<typeof mailHealthEmployerSchema>;

export type AdminResult<T> = { ok: true; data: T } | { ok: false; refusal: AdminRefusalCode };

const refusalBodySchema = z.object({
  error: adminRefusalCodeSchema,
});

async function adminRequest<T>(response: Response, schema: z.ZodType<T>) {
  const raw: unknown = await response.json();
  const refusal = refusalBodySchema.safeParse(raw);

  if (!response.ok && refusal.success) {
    const denied: AdminResult<T> = { ok: false, refusal: refusal.data.error };

    return denied;
  }

  if (!response.ok) {
    throw new Error(`The admin request did not go through (${String(response.status)}).`);
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
  | { email: string }
  | { reason: string }
  | { value: string }
  | { providers: string[]; pages: string[]; sessionsPerPage: number };

async function adminWrite<T>(
  method: "POST" | "PUT",
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

export const loadSettings = async () => adminGet("/admin/api/settings", settingsResponseSchema);

export const loadProviderReport = async () =>
  adminGet("/admin/api/provider-report", providerReportSchema);

export const runLab = async (providers: string[], pages: string[], sessionsPerPage: number) =>
  adminPost("/admin/api/lab/runs", { pages, providers, sessionsPerPage }, labRunResponseSchema);

export const loadKillSwitches = async () =>
  adminGet("/admin/api/kill-switches", killSwitchesResponseSchema);

export const loadCatalog = async () => adminGet("/admin/api/catalog", catalogResponseSchema);

export const loadMailHealth = async (days: number) =>
  adminGet(`/admin/api/mail-health?days=${String(days)}`, mailHealthSchema);

export const saveSetting = async (settingKey: string, value: string) =>
  adminPut(`/admin/api/settings/${settingKey}`, { value }, settingResponseSchema);

export const setKillSwitch = async (scope: string, key: string, enabled: boolean, reason: string) =>
  adminPut(
    `/admin/api/kill-switches/${scope}/${key}`,
    { enabled, reason },
    killSwitchResponseSchema,
  );

export const loadGrants = async () => adminGet("/admin/api/grants", grantsResponseSchema);

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

export const loadAdminSession = async () => adminGet("/admin/api/session", adminSessionSchema);

export const loadInvites = async () => adminGet("/admin/api/invites", invitesResponseSchema);

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
