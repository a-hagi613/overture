import { z } from "zod";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY = 500;

const cloudflareErrorsSchema = z.array(z.object({ code: z.number(), message: z.string() }));

const subdomainSchema = z.object({
  enabled: z.boolean(),
  name: z.string().min(1),
  tag: z.string().min(1),
  dkim_selector: z.string().min(1).optional(),
  return_path_domain: z.string().min(1).optional(),
});

const subdomainListSchema = z.object({
  success: z.boolean(),
  errors: cloudflareErrorsSchema.optional(),
  result: z.array(subdomainSchema),
});

const subdomainResponseSchema = z.object({
  success: z.boolean(),
  errors: cloudflareErrorsSchema.optional(),
  result: subdomainSchema.optional(),
});

const dnsRecordSchema = z.object({
  content: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
});

const dnsListSchema = z.object({
  success: z.boolean(),
  errors: cloudflareErrorsSchema.optional(),
  result: z.array(dnsRecordSchema),
});

const zoneListSchema = z.object({
  success: z.boolean(),
  errors: cloudflareErrorsSchema.optional(),
  result: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
});

export interface EmailSendingConfig {
  accountId: string | null;
  zoneId: string | null;
  apiToken: string;
  baseUrl: string;
  domain: string;
}

export interface SendingSubdomain {
  enabled: boolean;
  name: string;
  tag: string;
  dkimSelector: string | null;
  returnPathDomain: string | null;
}

export interface SendingDnsRecord {
  content: string | null;
  name: string | null;
  type: string | null;
}

export type EmailSendingPlan = "entitled" | "not-entitled" | "unknown";

export interface EmailSendingRecordCheck {
  kind: "mx" | "spf" | "dkim" | "dmarc";
  name: string;
  ok: boolean;
  detail: string;
}

export interface EmailSendingReadiness {
  domain: string;
  ready: boolean;
  plan: EmailSendingPlan;
  onboarded: boolean;
  enabled: boolean;
  returnPathDomain: string | null;
  dkimSelector: string | null;
  records: EmailSendingRecordCheck[];
  error: string | null;
}

export class CloudflareApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`Cloudflare Email Sending API ${String(status)}: ${detail}`);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

function baseUrl(config: EmailSendingConfig) {
  return config.baseUrl.replace(/\/+$/u, "");
}

function errorDetail(text: string) {
  try {
    const parsed = z.object({ errors: cloudflareErrorsSchema.optional() }).parse(JSON.parse(text));

    const messages = (parsed.errors ?? []).map((error) => `${String(error.code)} ${error.message}`);

    if (messages.length > 0) {
      return messages.join("; ");
    }
  } catch {}

  return text.slice(0, MAX_ERROR_BODY);
}

async function request(
  config: EmailSendingConfig,
  path: string,
  init?: { method?: "GET" | "POST"; body?: string },
) {
  const response = await fetch(`${baseUrl(config)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new CloudflareApiError(response.status, errorDetail(text));
  }

  return text;
}

function normaliseSubdomain(subdomain: z.infer<typeof subdomainSchema>) {
  return {
    enabled: subdomain.enabled,
    name: subdomain.name,
    tag: subdomain.tag,
    dkimSelector: subdomain.dkim_selector ?? null,
    returnPathDomain: subdomain.return_path_domain ?? null,
  };
}

export async function resolveZoneId(config: EmailSendingConfig) {
  if (config.zoneId !== null) {
    return config.zoneId;
  }

  const query = new URLSearchParams({ name: config.domain });
  const text = await request(config, `/zones?${query.toString()}`);
  const parsed = zoneListSchema.parse(JSON.parse(text));
  const [zone] = parsed.result;

  if (zone === undefined) {
    throw new Error(
      `Cloudflare returned no zone named ${config.domain} to this token; set CLOUDFLARE_ZONE_ID.`,
    );
  }

  return zone.id;
}

export async function listSendingSubdomains(config: EmailSendingConfig, zoneId: string) {
  const text = await request(config, `/zones/${zoneId}/email/sending/subdomains`);
  const parsed = subdomainListSchema.parse(JSON.parse(text));

  if (!parsed.success) {
    throw new CloudflareApiError(200, errorDetail(text));
  }

  return parsed.result.map(normaliseSubdomain);
}

export async function createSendingSubdomain(
  config: EmailSendingConfig,
  zoneId: string,
  name: string,
) {
  const text = await request(config, `/zones/${zoneId}/email/sending/subdomains`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

  const parsed = subdomainResponseSchema.parse(JSON.parse(text));

  if (!parsed.success || parsed.result === undefined) {
    throw new CloudflareApiError(200, errorDetail(text));
  }

  return normaliseSubdomain(parsed.result);
}

export async function readSendingRecords(config: EmailSendingConfig, zoneId: string, tag: string) {
  const text = await request(config, `/zones/${zoneId}/email/sending/subdomains/${tag}/dns`);
  const parsed = dnsListSchema.parse(JSON.parse(text));

  if (!parsed.success) {
    throw new CloudflareApiError(200, errorDetail(text));
  }

  return parsed.result.map(
    (record) =>
      ({
        content: record.content ?? null,
        name: record.name ?? null,
        type: record.type ?? null,
      }) satisfies SendingDnsRecord,
  );
}

function txtRecords(records: SendingDnsRecord[], name: string) {
  return records.filter((record) => record.type === "TXT" && record.name === name);
}

export function verifySendingRecords(
  domain: string,
  subdomain: SendingSubdomain,
  records: SendingDnsRecord[],
) {
  const bounceName = subdomain.returnPathDomain ?? `cf-bounce.${domain}`;
  const dkimName = `${subdomain.dkimSelector ?? "cf-bounce"}._domainkey.${domain}`;
  const dmarcName = `_dmarc.${domain}`;

  const mx = records.filter((record) => record.type === "MX" && record.name === bounceName);

  const mxOk =
    mx.length > 0 && mx.every((record) => (record.content ?? "").endsWith(".mx.cloudflare.net"));

  const spf = txtRecords(records, bounceName).filter((record) =>
    (record.content ?? "").startsWith("v=spf1"),
  );

  const spfOk = spf.some((record) =>
    (record.content ?? "").includes("include:_spf.mx.cloudflare.net"),
  );

  const dkim = txtRecords(records, dkimName).filter((record) =>
    (record.content ?? "").startsWith("v=DKIM1"),
  );

  const dkimOk = dkim.some((record) => (record.content ?? "").includes("p="));

  const dmarc = txtRecords(records, dmarcName).filter((record) =>
    (record.content ?? "").includes("v=DMARC1"),
  );

  const dmarcOk = dmarc.some((record) => (record.content ?? "").includes("p=reject"));

  const checks: EmailSendingRecordCheck[] = [
    {
      kind: "mx",
      name: bounceName,
      ok: mxOk,
      detail: mxOk
        ? `${String(mx.length)} bounce MX records`
        : `no bounce MX record pointing at Cloudflare on ${bounceName}`,
    },
    {
      kind: "spf",
      name: bounceName,
      ok: spfOk,
      detail: spfOk
        ? `v=spf1 include:_spf.mx.cloudflare.net`
        : `no SPF TXT record with include:_spf.mx.cloudflare.net on ${bounceName}`,
    },
    {
      kind: "dkim",
      name: dkimName,
      ok: dkimOk,
      detail: dkimOk
        ? "v=DKIM1 with a public key"
        : `no DKIM1 TXT record with a public key on ${dkimName}`,
    },
    {
      kind: "dmarc",
      name: dmarcName,
      ok: dmarcOk,
      detail: dmarcOk ? "v=DMARC1; p=reject" : `no DMARC record with p=reject on ${dmarcName}`,
    },
  ];

  return checks;
}

function failedReadiness(config: EmailSendingConfig, plan: EmailSendingPlan, error: string) {
  return {
    domain: config.domain,
    ready: false,
    plan,
    onboarded: false,
    enabled: false,
    returnPathDomain: null,
    dkimSelector: null,
    records: [],
    error,
  } satisfies EmailSendingReadiness;
}

function messageFor(error: Error) {
  return error.message;
}

export async function readEmailSendingReadiness(config: EmailSendingConfig) {
  let zoneId: string;

  try {
    zoneId = await resolveZoneId(config);
  } catch (error) {
    return failedReadiness(
      config,
      "unknown",
      `the Cloudflare zone could not be read: ${messageFor(error instanceof Error ? error : new Error(String(error)))}`,
    );
  }

  let subdomains: SendingSubdomain[];

  try {
    subdomains = await listSendingSubdomains(config, zoneId);
  } catch (error) {
    const refused = error instanceof CloudflareApiError && error.status === 403;

    const hint = refused
      ? " Workers Paid and the Cloudflare Email Sending entitlement are required; pay it, then run scripts/onboard-email-sending.ts (docs/DEPLOY.md, M2-02)."
      : "";

    return failedReadiness(
      config,
      refused ? "not-entitled" : "unknown",
      `Cloudflare Email Sending could not be read: ${messageFor(error instanceof Error ? error : new Error(String(error)))}.${hint}`,
    );
  }

  const subdomain = subdomains.find((entry) => entry.name === config.domain);

  if (subdomain === undefined) {
    return {
      ...failedReadiness(
        config,
        "entitled",
        `${config.domain} is not onboarded for Cloudflare Email Sending; run scripts/onboard-email-sending.ts (docs/DEPLOY.md, M2-02).`,
      ),
      onboarded: false,
    } satisfies EmailSendingReadiness;
  }

  if (!subdomain.enabled) {
    return {
      ...failedReadiness(
        config,
        "entitled",
        `${config.domain} is onboarded for Cloudflare Email Sending but sending is disabled; run scripts/onboard-email-sending.ts to re-enable it.`,
      ),
      onboarded: true,
    } satisfies EmailSendingReadiness;
  }

  let records: SendingDnsRecord[];

  try {
    records = await readSendingRecords(config, zoneId, subdomain.tag);
  } catch (error) {
    return {
      ...failedReadiness(
        config,
        "entitled",
        `Cloudflare did not return the expected DNS records for ${config.domain}: ${messageFor(error instanceof Error ? error : new Error(String(error)))}`,
      ),
      onboarded: true,
      enabled: true,
    } satisfies EmailSendingReadiness;
  }

  const checks = verifySendingRecords(config.domain, subdomain, records);
  const failing = checks.filter((check) => !check.ok);

  return {
    domain: config.domain,
    ready: failing.length === 0,
    plan: "entitled",
    onboarded: true,
    enabled: true,
    returnPathDomain: subdomain.returnPathDomain,
    dkimSelector: subdomain.dkimSelector,
    records: checks,
    error:
      failing.length === 0
        ? null
        : `not ready: ${failing.map((check) => `${check.kind} (${check.name}: ${check.detail})`).join("; ")}. Wait for DNS propagation and re-run the check.`,
  } satisfies EmailSendingReadiness;
}
