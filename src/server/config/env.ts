import { z } from "zod";

import { turnstileScriptUrl } from "../../shared/turnstile.ts";
import {
  DRY_SUBMIT_ENV,
  DRY_SUBMIT_PRODUCTION_REFUSAL,
  isDrySubmitValue,
  parseDrySubmitFlag,
} from "../dispatch/dry-submit.ts";
import { masterKeyChainProblem, parseMasterKeyring } from "../platform/crypto.ts";
import type { MasterKeyring } from "../platform/crypto.ts";
import { catalogPathFor } from "../platform/db/client.ts";
import { DEFAULT_ANTHROPIC_MODEL } from "../platform/llm/models.ts";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const oauthPairs = [
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
] as const;

const localHostnames = ["localhost", "127.0.0.1"];

const MIN_SECRET_LENGTH = 16;

/**
 * Splits a comma-separated address list into trimmed, lowercased entries.
 * @param value The raw environment value; an empty or missing value yields no entries.
 * @returns The addresses that remain after blank entries are dropped.
 */
export function emailListFromValue(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** One versioned Better Auth secret, as `BETTER_AUTH_SECRETS` names it. */
export interface VersionedAuthSecret {
  version: number;
  value: string;
}

/** The Better Auth signing secrets this process accepts, current first. */
export interface AuthSecretConfig {
  /** The secret new tokens and invites are signed with. */
  current: string;
  /** Every accepted secret, current first; undefined keeps the single-secret deployment unchanged. */
  secrets?: VersionedAuthSecret[];
  /** Every accepted secret value, for HMAC lookups that must still read what an older secret signed. */
  accepted: readonly string[];
  /** The legacy `BETTER_AUTH_SECRET` fallback for payloads written before versioned secrets. */
  legacy?: string;
}

/**
 * Parses `BETTER_AUTH_SECRETS` (`"2:<new>,1:<old>"`) into Better Auth's ordered `secrets`
 * option, falling back to the single `BETTER_AUTH_SECRET` deployment.
 * @param source The two environment names and their values.
 * @returns The current secret, the versioned list when set, and every accepted value.
 */
export function parseBetterAuthSecrets(source: {
  BETTER_AUTH_SECRET?: string | undefined;
  BETTER_AUTH_SECRETS?: string | undefined;
}) {
  const raw = source.BETTER_AUTH_SECRETS?.trim();
  const legacy = source.BETTER_AUTH_SECRET;

  if (raw === undefined || raw.length === 0) {
    if (legacy === undefined) {
      throw new Error(
        "Set BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS: Better Auth needs at least one signing secret.",
      );
    }

    return { accepted: [legacy], current: legacy };
  }

  const seen = new Set<number>();

  const secrets = raw.split(",").map((entry, index) => {
    const at = entry.indexOf(":");
    const versionText = at === -1 ? "" : entry.slice(0, at).trim();
    const value = at === -1 ? "" : entry.slice(at + 1).trim();
    const position = index + 1;

    if (!/^[1-9]\d*$/u.test(versionText)) {
      throw new Error(
        `BETTER_AUTH_SECRETS entry ${String(position)} must be "<version>:<secret>" with a positive integer version.`,
      );
    }

    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `BETTER_AUTH_SECRETS version ${versionText} needs at least ${String(MIN_SECRET_LENGTH)} characters.`,
      );
    }

    const version = Number(versionText);

    if (seen.has(version)) {
      throw new Error(`BETTER_AUTH_SECRETS lists version ${versionText} more than once.`);
    }

    seen.add(version);

    return { version, value };
  });

  const [current] = secrets;

  if (current === undefined) {
    throw new Error("BETTER_AUTH_SECRETS must list at least one version.");
  }

  const outOfOrder = secrets.findIndex(
    (secret, index) => index > 0 && secret.version >= (secrets[index - 1]?.version ?? 0),
  );

  if (outOfOrder !== -1) {
    throw new Error(
      "BETTER_AUTH_SECRETS must list versions highest first, with the current version first (for example 2:<new>,1:<old>).",
    );
  }

  const config: AuthSecretConfig = {
    accepted: [...new Set([...secrets.map((secret) => secret.value), ...(legacy ? [legacy] : [])])],
    current: current.value,
    secrets,
  };

  if (legacy !== undefined) {
    config.legacy = legacy;
  }

  return config;
}

/**
 * The Better Auth options that carry a secret chain: `secrets` first (current key first), with
 * the legacy single secret as the fallback for payloads written before versioned secrets.
 * @param config The parsed environment secrets.
 * @returns The `secret` and `secrets` fields to pass to `betterAuth`.
 */
export function betterAuthSecretOptions(config: AuthSecretConfig) {
  return {
    secret: config.legacy ?? config.current,
    secrets: config.secrets,
  };
}

/**
 * The hostnames the Turnstile widget may use when `TURNSTILE_HOSTNAMES` is unset: both origins,
 * because the owner signs in on the admin host as well as the app host.
 * @param appOrigin The public app origin, or undefined before it is configured.
 * @param adminOrigin The admin host origin.
 * @returns The deduplicated hostname allowlist.
 */
export function turnstileDefaultHostnames(appOrigin: string | undefined, adminOrigin: string) {
  if (appOrigin === undefined) {
    return localHostnames;
  }

  return [...new Set([new URL(appOrigin).hostname, new URL(adminOrigin).hostname])];
}

/**
 * Resolves the Turnstile allowlist from the configured value or the two origins.
 * @param configured The `TURNSTILE_HOSTNAMES` value, when set.
 * @param appOrigin The public app origin, or undefined before it is configured.
 * @param adminOrigin The admin host origin.
 * @returns The hostnames the widget may report.
 */
export function resolveTurnstileHostnames(
  configured: readonly string[] | undefined,
  appOrigin: string | undefined,
  adminOrigin: string,
) {
  return configured ?? turnstileDefaultHostnames(appOrigin, adminOrigin);
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    KILL_TIMEOUT_MS: z.coerce.number().int().min(1).default(240_000),
    JOBS_STARTUP_SETTLE_MS: z.coerce.number().int().min(0).default(5000),
    JOBS_AUTORUN: booleanFromString.default(true),
    DATABASE_URL: z.string().min(1).default("data/overture.db"),
    DATABASE_PATH: z.string().min(1).optional(),
    CATALOG_DATABASE_PATH: z.string().min(1).optional(),
    STATIC_ROOT: z.string().min(1).default("dist"),
    ENABLE_TEST_ROUTES: booleanFromString.default(false),
    [DRY_SUBMIT_ENV]: z
      .string()
      .default("0")
      .refine(isDrySubmitValue, {
        message: `${DRY_SUBMIT_ENV} must be one of 1, 0, true or false.`,
      })
      .transform(parseDrySubmitFlag),
    DEMO_LOGIN_ENABLED: booleanFromString.default(false),
    PUBLIC_SIGNUP_ENABLED: booleanFromString.default(true),
    GREENHOUSE_FEED_BASE_URL: z.string().min(1).optional(),
    GREENHOUSE_BOARD_BASE_URL: z.url().optional(),
    LEVER_FEED_BASE_URL: z.string().min(1).optional(),
    LEVER_EU_FEED_BASE_URL: z.string().min(1).optional(),
    LEVER_JOBS_BASE_URL: z.string().min(1).optional(),
    LEVER_EU_JOBS_BASE_URL: z.string().min(1).optional(),
    ASHBY_FEED_BASE_URL: z.string().min(1).optional(),
    ASHBY_JOBS_BASE_URL: z.string().min(1).optional(),
    PERSONIO_FEED_BASE_URL: z.string().min(1).optional(),
    WORKABLE_FORM_BASE_URL: z.url().optional(),
    APP_ORIGIN: z.url().optional(),
    ADMIN_ORIGIN: z.url().default("https://admin.tryoverture.com"),
    CF_ACCESS_AUD: z.string().min(1).optional(),
    CF_ACCESS_TEAM_DOMAIN: z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+$/u)
      .optional(),
    CF_ACCESS_JWKS_URL: z.url().optional(),
    AUTH_ALLOWED_HOSTS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(",")
          .map((host) => host.trim())
          .filter((host) => host.length > 0),
      )
      .optional(),
    ALLOWED_SIGNUP_EMAILS: z
      .string()
      .optional()
      .transform((value) => emailListFromValue(value))
      .pipe(z.array(z.email())),
    BETTER_AUTH_SECRET: z.string().min(16).optional(),
    BETTER_AUTH_SECRETS: z.string().min(1).optional(),
    OWNER_EMAIL: z.email(),
    TURNSTILE_SITE_KEY: z.string().min(1),
    TURNSTILE_SECRET: z.string().min(1),
    TURNSTILE_SCRIPT_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith("/") || value.startsWith("https://"), {
        message: "TURNSTILE_SCRIPT_URL must be an https URL or a same-origin path",
      })
      .default(turnstileScriptUrl),
    TURNSTILE_HOSTNAMES: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(",")
          .map((host) => host.trim().toLowerCase())
          .filter((host) => host.length > 0),
      )
      .optional(),
    LAB_BASE_URL: z.url().optional(),
    LAB_RECAPTCHA_SCRIPT_URL: z.string().min(1).default("https://www.google.com/recaptcha/api.js"),
    LAB_RECAPTCHA_SITE_KEY: z.string().min(1).default("lab-recaptcha-site-key"),
    LAB_HCAPTCHA_SCRIPT_URL: z.string().min(1).default("https://js.hcaptcha.com/1/api.js"),
    LAB_HCAPTCHA_SITE_KEY: z.string().min(1).default("lab-hcaptcha-site-key"),
    LAB_TURNSTILE_SCRIPT_URL: z
      .string()
      .min(1)
      .default("https://challenges.cloudflare.com/turnstile/v0/api.js"),
    LAB_TURNSTILE_SITE_KEY: z.string().min(1).default("lab-turnstile-site-key"),
    LAB_RECAPTCHA_VERIFY_URL: z.url().default("https://www.google.com/recaptcha/api/siteverify"),
    LAB_RECAPTCHA_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
    LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),
    OAUTH_GOOGLE_DISCOVERY_URL: z.url().optional(),
    OAUTH_LINKEDIN_DISCOVERY_URL: z.url().optional(),
    MASTER_KEY_CURRENT: z.coerce.number().int().min(1).default(1),
    OBJECT_STORE_ROOT: z.string().min(1).default("data/objects"),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET_FILES: z.string().min(1).optional(),
    R2_BUCKET_BACKUPS: z.string().min(1).optional(),
    R2_ENDPOINT: z.url().optional(),
    MAIL_FROM: z.email().default("no-reply@tryoverture.com"),
    SUPPORT_EMAIL: z.email().default("admin@tryoverture.com"),
    MAIL_DOMAIN: z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+$/u)
      .default("tryoverture.com"),
    ALIAS_EMAIL_DOMAIN: z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+$/u)
      .optional(),
    NOTIFY_MAIL_DOMAIN: z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+$/u)
      .default("notify.tryoverture.com"),
    CLOUDFLARE_EMAIL_API_TOKEN: z.string().min(1).optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_ZONE_ID: z.string().min(1).optional(),
    CLOUDFLARE_EMAIL_API_BASE_URL: z.url().default("https://api.cloudflare.com/client/v4"),
    REQUIRE_EMAIL_SENDING: booleanFromString.default(false),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_API_BASE_URL: z.url().default("https://api.stripe.com"),
    STRIPE_PRICE_WEEK: z.string().min(1).optional(),
    STRIPE_PRICE_MONTH: z.string().min(1).optional(),
    CARD_FINGERPRINT_SECRET: z.string().min(32).optional(),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).default("mailto:admin@tryoverture.com"),
    INBOUND_HMAC_SECRET: z.string().min(16).optional(),
    INBOUND_DNS_SERVER: z.string().min(1).optional(),
    ALERT_NTFY_URL: z.url().optional(),
    LOKI_URL: z.url().optional(),
    LOKI_AUTH_TOKEN: z.string().min(1).optional(),
    LOKI_TENANT_ID: z.string().min(1).optional(),
    LOKI_SERVICE_NAME: z.string().min(1).default("overture"),
    LOKI_AUDIT_JOB: z.string().min(1).default("overture-admin-audit"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    OTEL_DEBUG: booleanFromString.default(false),
    OTEL_SIMPLE_EXPORT: booleanFromString.default(false),
    METRICS_ENABLED: booleanFromString.default(false),
    METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(9091),
    METRICS_HOST: z.string().min(1).default("::"),
    OPS_HEALTH_SECRET: z.string().min(16).optional(),
    LITESTREAM_ENABLED: booleanFromString.default(true),
    LITESTREAM_OWNS_CHECKPOINTS: booleanFromString.default(false),
    LITESTREAM_RESTORE_ONLY: booleanFromString.default(false),
    LITESTREAM_CONFIG_PATH: z.string().min(1).optional(),
    LITESTREAM_BINARY: z.string().min(1).default("litestream"),
    BROWSER_USE_API_KEY: z.string().min(1).optional(),
    BROWSER_USE_API_BASE_URL: z.url().default("https://api.browser-use.com"),
    KERNEL_API_KEY: z.string().min(1).optional(),
    KERNEL_API_BASE_URL: z.url().default("https://api.onkernel.com"),
    BROWSER_PROVIDER: z.enum(["local", "browser_use", "kernel"]).optional(),
    SEND_HARD_TIMEOUT_MS: z.coerce.number().int().min(1).default(900_000),
    BROWSER_USE_USAGE_SETTLE_MS: z.coerce.number().int().min(1).default(30_000),
    BROWSER_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
    BROWSER_SESSION_DIR: z.string().min(1).optional(),
    BROWSER_PROXY_COUNTRY: z
      .string()
      .length(2)
      .transform((value) => value.toLowerCase())
      .default("ca"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_BASE_URL: z.url().default("https://api.anthropic.com"),
    ANTHROPIC_MODEL: z.string().min(1).default(DEFAULT_ANTHROPIC_MODEL),
    ANTHROPIC_BATCH_POLL_INTERVAL_MS: z.coerce.number().int().min(10).default(10_000),
    ANTHROPIC_BATCH_WAIT_MS: z.coerce.number().int().min(1000).default(3_600_000),
    ANTHROPIC_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    ANTHROPIC_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
    FREEHIRE_API_KEY: z.string().optional(),
    FREEHIRE_BASE_URL: z.url().default("https://freehire.me"),
    FLY_APP_NAME: z.string().min(1).optional(),
    FLY_MACHINE_ID: z.string().min(1).optional(),
    GRAFANA_DASHBOARD_URL: z.url().optional(),
  })
  .superRefine((value, context) => {
    if (value.ENABLE_TEST_ROUTES && (value.NODE_ENV === "production" || value.FLY_APP_NAME)) {
      context.addIssue({
        code: "custom",
        message: "ENABLE_TEST_ROUTES must not be true in production or on Fly.",
        path: ["ENABLE_TEST_ROUTES"],
      });
    }

    if (!value.JOBS_AUTORUN && (value.NODE_ENV === "production" || value.FLY_APP_NAME)) {
      context.addIssue({
        code: "custom",
        message: "JOBS_AUTORUN must not be false in production or on Fly.",
        path: ["JOBS_AUTORUN"],
      });
    }

    if (value[DRY_SUBMIT_ENV] && (value.NODE_ENV === "production" || value.FLY_APP_NAME)) {
      context.addIssue({
        code: "custom",
        message: DRY_SUBMIT_PRODUCTION_REFUSAL,
        path: [DRY_SUBMIT_ENV],
      });
    }

    if (value.NODE_ENV === "production") {
      if (value.AUTH_ALLOWED_HOSTS !== undefined) {
        context.addIssue({
          code: "custom",
          message:
            "AUTH_ALLOWED_HOSTS must be empty in production: APP_ORIGIN names the only allowed host.",
          path: ["AUTH_ALLOWED_HOSTS"],
        });
      }

      if (value.CF_ACCESS_AUD === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Production admin host mode needs CF_ACCESS_AUD: the admin API must never run without its Cloudflare Access audience.",
          path: ["CF_ACCESS_AUD"],
        });
      }

      if (value.CF_ACCESS_TEAM_DOMAIN === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Production admin host mode needs CF_ACCESS_TEAM_DOMAIN so the Access token's iss claim is verified: CF_ACCESS_JWKS_URL alone cannot name the issuer.",
          path: ["CF_ACCESS_TEAM_DOMAIN"],
        });
      }

      const hostnames = resolveTurnstileHostnames(
        value.TURNSTILE_HOSTNAMES,
        value.APP_ORIGIN,
        value.ADMIN_ORIGIN,
      );

      for (const local of localHostnames) {
        if (hostnames.includes(local)) {
          context.addIssue({
            code: "custom",
            message: `TURNSTILE_HOSTNAMES must not include ${local} in production.`,
            path: ["TURNSTILE_HOSTNAMES"],
          });
        }
      }

      if (value.TURNSTILE_HOSTNAMES === undefined && value.APP_ORIGIN === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Production needs APP_ORIGIN or TURNSTILE_HOSTNAMES to name the Turnstile hostnames.",
          path: ["TURNSTILE_HOSTNAMES"],
        });
      }
    }

    try {
      parseBetterAuthSecrets(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
        path: ["BETTER_AUTH_SECRETS"],
      });
    }

    for (const [idName, secretName] of oauthPairs) {
      if ((value[idName] === undefined) !== (value[secretName] === undefined)) {
        context.addIssue({
          code: "custom",
          message: `${idName} and ${secretName} are optional only as a pair: set both or neither.`,
          path: [value[idName] === undefined ? idName : secretName],
        });
      }
    }

    if (
      (value.CLOUDFLARE_EMAIL_API_TOKEN === undefined) !==
      (value.CLOUDFLARE_ACCOUNT_ID === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set together or not at all: both send mail through Cloudflare Email Sending, neither uses the sink.",
        path: [
          value.CLOUDFLARE_EMAIL_API_TOKEN === undefined
            ? "CLOUDFLARE_EMAIL_API_TOKEN"
            : "CLOUDFLARE_ACCOUNT_ID",
        ],
      });
    }

    if ((value.VAPID_PUBLIC_KEY === undefined) !== (value.VAPID_PRIVATE_KEY === undefined)) {
      context.addIssue({
        code: "custom",
        message: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set together or not at all.",
        path: [value.VAPID_PUBLIC_KEY === undefined ? "VAPID_PUBLIC_KEY" : "VAPID_PRIVATE_KEY"],
      });
    }

    if ((value.STRIPE_SECRET_KEY === undefined) !== (value.STRIPE_WEBHOOK_SECRET === undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set together or not at all: both turn billing on, neither leaves it off.",
        path: [
          value.STRIPE_SECRET_KEY === undefined ? "STRIPE_SECRET_KEY" : "STRIPE_WEBHOOK_SECRET",
        ],
      });
    }

    const r2Credentials = [value.R2_ACCOUNT_ID, value.R2_ACCESS_KEY_ID, value.R2_SECRET_ACCESS_KEY];
    const r2CredentialsPresent = r2Credentials.filter((entry) => entry !== undefined).length;

    if (r2CredentialsPresent > 0 && r2CredentialsPresent < r2Credentials.length) {
      context.addIssue({
        code: "custom",
        message:
          "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set together or not at all.",
        path: ["R2_ACCOUNT_ID"],
      });
    }

    if (value.R2_BUCKET_FILES !== undefined && r2CredentialsPresent < r2Credentials.length) {
      context.addIssue({
        code: "custom",
        message: "R2_BUCKET_FILES needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
        path: ["R2_BUCKET_FILES"],
      });
    }

    if (value.R2_BUCKET_BACKUPS !== undefined && r2CredentialsPresent < r2Credentials.length) {
      context.addIssue({
        code: "custom",
        message:
          "R2_BUCKET_BACKUPS needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
        path: ["R2_BUCKET_BACKUPS"],
      });
    }

    if (value.R2_ENDPOINT !== undefined && value.R2_BUCKET_FILES === undefined) {
      context.addIssue({
        code: "custom",
        message: "R2_ENDPOINT overrides the R2 files endpoint and needs R2_BUCKET_FILES.",
        path: ["R2_ENDPOINT"],
      });
    }
  });

export const checkedEnvSchema = envSchema.superRefine((value, context) => {
  const problem = masterKeyChainProblem(process.env, value.MASTER_KEY_CURRENT);

  if (problem !== undefined) {
    context.addIssue({ code: "custom", message: problem, path: ["MASTER_KEY_CURRENT"] });
  }
});

export const env = checkedEnvSchema.parse(process.env);

/** The current Better Auth secret, its rotation chain, and the legacy fallback (issue #578). */
export const authSecretConfig: AuthSecretConfig = parseBetterAuthSecrets(env);

/** The current master key and every older key still configured for the dual-read window. */
export const masterKeyring: MasterKeyring = parseMasterKeyring(process.env, env.MASTER_KEY_CURRENT);

export const databasePath = env.DATABASE_PATH ?? env.DATABASE_URL;

export const aliasEmailDomain = (env.ALIAS_EMAIL_DOMAIN ?? env.MAIL_DOMAIN).trim().toLowerCase();

/**
 * Where `catalog.sqlite` lives (ADR 0036). It sits beside the application database unless `CATALOG_DATABASE_PATH`
 * overrides it, so a Fly volume with `/data/app.sqlite` gets `/data/catalog.sqlite`.
 */
export const catalogDatabasePath = env.CATALOG_DATABASE_PATH ?? catalogPathFor(databasePath);

export const turnstileHostnames = resolveTurnstileHostnames(
  env.TURNSTILE_HOSTNAMES,
  env.APP_ORIGIN,
  env.ADMIN_ORIGIN,
);

export const labBaseUrl = env.LAB_BASE_URL ?? env.APP_ORIGIN ?? null;

export const labEnvironment = {
  hcaptchaScriptUrl: env.LAB_HCAPTCHA_SCRIPT_URL,
  hcaptchaSiteKey: env.LAB_HCAPTCHA_SITE_KEY,
  recaptchaScriptUrl: env.LAB_RECAPTCHA_SCRIPT_URL,
  recaptchaSiteKey: env.LAB_RECAPTCHA_SITE_KEY,
  turnstileScriptUrl: env.LAB_TURNSTILE_SCRIPT_URL,
  turnstileSiteKey: env.LAB_TURNSTILE_SITE_KEY,
} as const;

export type Env = z.infer<typeof envSchema>;
