import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  KILL_TIMEOUT_MS: z.coerce.number().int().min(1).default(270_000),
  DATABASE_URL: z.string().min(1).default("data/overture.db"),
  DATABASE_PATH: z.string().min(1).optional(),
  STATIC_ROOT: z.string().min(1).default("dist"),
  ENABLE_TEST_ROUTES: booleanFromString.default(false),
  GREENHOUSE_FEED_BASE_URL: z.string().min(1).optional(),
  LEVER_FEED_BASE_URL: z.string().min(1).optional(),
  ASHBY_FEED_BASE_URL: z.string().min(1).optional(),
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
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  OAUTH_GOOGLE_DISCOVERY_URL: z.url().optional(),
  OAUTH_LINKEDIN_DISCOVERY_URL: z.url().optional(),
  MAIL_FROM: z.email().default("no-reply@tryoverture.com"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_DEBUG: booleanFromString.default(false),
  OTEL_SIMPLE_EXPORT: booleanFromString.default(false),
  LITESTREAM_ENABLED: booleanFromString.default(true),
  LITESTREAM_RESTORE_ONLY: booleanFromString.default(false),
  LITESTREAM_CONFIG_PATH: z.string().min(1).optional(),
  BROWSER_USE_API_KEY: z.string().min(1).optional(),
  BROWSER_USE_API_BASE_URL: z.url().default("https://api.browser-use.com"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().default("https://api.anthropic.com"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  FLY_APP_NAME: z.string().min(1).optional(),
  FLY_MACHINE_ID: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);

export const databasePath = env.DATABASE_PATH ?? env.DATABASE_URL;

export type Env = z.infer<typeof envSchema>;
