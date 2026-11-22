import { z } from "zod";

import { turnstileScriptUrl } from "../../shared/turnstile.ts";
import { DEFAULT_ANTHROPIC_MODEL } from "../platform/llm/models.ts";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const oauthPairs = [
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
] as const;

const localHostnames = ["localhost", "127.0.0.1"];

function turnstileDefaultHostnames(appOrigin: string | undefined) {
  return appOrigin === undefined ? localHostnames : [new URL(appOrigin).hostname];
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    KILL_TIMEOUT_MS: z.coerce.number().int().min(1).default(20_000),
    JOBS_STARTUP_SETTLE_MS: z.coerce.number().int().min(0).default(5000),
    JOBS_AUTORUN: booleanFromString.default(true),
    DATABASE_URL: z.string().min(1).default("data/overture.db"),
    DATABASE_PATH: z.string().min(1).optional(),
    STATIC_ROOT: z.string().min(1).default("dist"),
    ENABLE_TEST_ROUTES: booleanFromString.default(false),
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
    WORKABLE_FEED_URL: z.url().optional(),
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
    BETTER_AUTH_SECRET: z.string().min(16),
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
    MASTER_KEY_V1: z
      .string()
      .trim()
      .refine((value) => Buffer.from(value, "base64").byteLength === 32, {
        message: "MASTER_KEY_V1 must decode to 32 bytes",
      }),
    MASTER_KEY_CURRENT: z.coerce.number().int().min(1).default(1),
    OBJECT_STORE_ROOT: z.string().min(1).default("data/objects"),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET_FILES: z.string().min(1).optional(),
    R2_ENDPOINT: z.url().optional(),
    MAIL_FROM: z.email().default("no-reply@tryoverture.com"),
    MAIL_DOMAIN: z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+$/u)
      .default("tryoverture.com"),
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
    LITESTREAM_ENABLED: booleanFromString.default(true),
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
    FLY_APP_NAME: z.string().min(1).optional(),
    FLY_MACHINE_ID: z.string().min(1).optional(),
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

    if (value.NODE_ENV === "production") {
      const hostnames =
        value.TURNSTILE_HOSTNAMES ??
        (value.APP_ORIGIN === undefined ? [] : turnstileDefaultHostnames(value.APP_ORIGIN));

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

    if (value.R2_ENDPOINT !== undefined && value.R2_BUCKET_FILES === undefined) {
      context.addIssue({
        code: "custom",
        message: "R2_ENDPOINT overrides the R2 files endpoint and needs R2_BUCKET_FILES.",
        path: ["R2_ENDPOINT"],
      });
    }
  });

export const env = envSchema.parse(process.env);

export const databasePath = env.DATABASE_PATH ?? env.DATABASE_URL;

export const turnstileHostnames =
  env.TURNSTILE_HOSTNAMES ?? turnstileDefaultHostnames(env.APP_ORIGIN);

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
