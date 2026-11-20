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
  audit: z.array(auditRowSchema),
});

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

export type AdminRefusalCode = z.infer<typeof adminRefusalCodeSchema>;

export type Overview = z.infer<typeof overviewSchema>;

export type AuditRow = z.infer<typeof auditRowSchema>;

export type KillSwitchRow = z.infer<typeof killSwitchRowSchema>;

export type GrantRow = z.infer<typeof grantRowSchema>;

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
  | { value: string };

async function adminWrite<T>(
  method: "POST" | "PUT",
  path: string,
  body: AdminWriteBody,
  schema: z.ZodType<T>,
) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });

  const result = await adminRequest(response, schema);

  if (!result.ok) {
    throw new Error(`The admin change was refused (${result.refusal}).`);
  }

  return result.data;
}

async function adminPost<T>(path: string, body: AdminWriteBody, schema: z.ZodType<T>) {
  return adminWrite("POST", path, body, schema);
}

async function adminPut<T>(path: string, body: AdminWriteBody, schema: z.ZodType<T>) {
  return adminWrite("PUT", path, body, schema);
}

export const loadOverview = async () => adminGet("/admin/api/overview", overviewSchema);

export const loadSettings = async () => adminGet("/admin/api/settings", settingsResponseSchema);

export const loadKillSwitches = async () =>
  adminGet("/admin/api/kill-switches", killSwitchesResponseSchema);

export const loadCatalog = async () => adminGet("/admin/api/catalog", catalogResponseSchema);

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
