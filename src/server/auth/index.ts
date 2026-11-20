import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { captcha, genericOAuth, magicLink } from "better-auth/plugins";

import type { AppDatabase } from "../platform/db/client.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { copy } from "../../shared/copy.ts";
import { env } from "../config/env.ts";
import { accounts, rateLimits, sessions, users, verifications } from "../platform/db/schema.ts";

const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const LINKEDIN_DISCOVERY_URL = "https://www.linkedin.com/oauth/.well-known/openid-configuration";

const discoveryDefaultsEnabled = env.NODE_ENV !== "test";

const googleProviderConfig = {
  providerId: "google",
  name: copy.auth.providers.google,
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  discoveryUrl: env.OAUTH_GOOGLE_DISCOVERY_URL ?? GOOGLE_DISCOVERY_URL,
  scopes: ["openid", "profile", "email"],
  requireEmailVerification: true,
};

const linkedinProviderConfig = {
  providerId: "linkedin",
  name: copy.auth.providers.linkedin,
  clientId: env.LINKEDIN_CLIENT_ID,
  clientSecret: env.LINKEDIN_CLIENT_SECRET,
  discoveryUrl: env.OAUTH_LINKEDIN_DISCOVERY_URL ?? LINKEDIN_DISCOVERY_URL,
  scopes: ["openid", "profile", "email"],
  requireEmailVerification: true,
};

const providerConfigs = [
  ...(env.OAUTH_GOOGLE_DISCOVERY_URL !== undefined || discoveryDefaultsEnabled
    ? [googleProviderConfig]
    : []),
  ...(env.OAUTH_LINKEDIN_DISCOVERY_URL !== undefined || discoveryDefaultsEnabled
    ? [linkedinProviderConfig]
    : []),
];

const ownerEmail = env.OWNER_EMAIL.toLowerCase();

export function isAllowedEmail(email: string) {
  return email.trim().toLowerCase() === ownerEmail;
}

const trustedOrigins = [
  ...(env.APP_ORIGIN === undefined ? [] : [env.APP_ORIGIN]),
  ...(env.AUTH_ALLOWED_HOSTS === undefined
    ? []
    : env.AUTH_ALLOWED_HOSTS.map((host) => `http://${host}:*`)),
];

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: AppDatabase, mailSender: MailSender) {
  return betterAuth({
    appName: copy.app.name,
    baseURL: env.APP_ORIGIN ?? {
      allowedHosts: env.AUTH_ALLOWED_HOSTS?.map((host) => `${host}:*`) ?? [
        "127.0.0.1:*",
        "localhost:*",
      ],
    },
    trustedOrigins,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        rateLimit: rateLimits,
      },
    }),
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "user", input: false },
      },
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/magic-link": { window: 15 * 60, max: 3 },
        "/sign-in/social": { window: 15 * 60, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = user.email.trim().toLowerCase();

            if (!isAllowedEmail(email)) {
              throw new APIError("FORBIDDEN", {
                code: "forbidden",
                message: copy.auth.accountRefused,
              });
            }

            const created = {
              data: { ...user, email, role: email === ownerEmail ? "owner" : "user" },
            };

            await Promise.resolve(created);

            return created;
          },
        },
      },
    },
    socialProviders: {},
    plugins: [
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET,
        endpoints: ["/sign-in/magic-link", "/sign-in/social"],
      }),
      genericOAuth({
        config: providerConfigs,
      }),
      magicLink({
        expiresIn: 15 * 60,
        rateLimit: { window: 15 * 60, max: 3 },
        disableSignUp: false,
        sendMagicLink: async (data) => {
          const email = data.email.trim().toLowerCase();

          if (!isAllowedEmail(email)) {
            throw new APIError("FORBIDDEN", {
              code: "forbidden",
              message: copy.auth.accountRefused,
            });
          }

          await mailSender.sendMagicLink({ to: email, url: data.url });
        },
      }),
    ],
  });
}
