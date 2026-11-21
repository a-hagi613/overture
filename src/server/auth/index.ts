import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { genericOAuth, magicLink } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { copy } from "../../shared/copy.ts";
import { env } from "../config/env.ts";
import {
  accounts,
  passkeys,
  rateLimits,
  sessions,
  users,
  verifications,
} from "../platform/db/schema.ts";
import { recordPasskeyAssertion } from "../platform/passkey/index.ts";
import { isSameMailbox } from "./email.ts";
import { verifyTurnstile } from "./turnstile-gate.ts";

const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const LINKEDIN_DISCOVERY_URL = "https://www.linkedin.com/oauth/.well-known/openid-configuration";

const discoveryDefaultsEnabled = env.NODE_ENV !== "test";

const googleDiscoveryUrl =
  env.OAUTH_GOOGLE_DISCOVERY_URL ?? (discoveryDefaultsEnabled ? GOOGLE_DISCOVERY_URL : undefined);

const linkedinDiscoveryUrl =
  env.OAUTH_LINKEDIN_DISCOVERY_URL ??
  (discoveryDefaultsEnabled ? LINKEDIN_DISCOVERY_URL : undefined);

const googleProviderConfig =
  env.GOOGLE_CLIENT_ID === undefined ||
  env.GOOGLE_CLIENT_SECRET === undefined ||
  googleDiscoveryUrl === undefined
    ? null
    : {
        providerId: "google",
        name: copy.auth.providers.google,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        discoveryUrl: googleDiscoveryUrl,
        scopes: ["openid", "profile", "email"],
        requireEmailVerification: true,
      };

const linkedinProviderConfig =
  env.LINKEDIN_CLIENT_ID === undefined ||
  env.LINKEDIN_CLIENT_SECRET === undefined ||
  linkedinDiscoveryUrl === undefined
    ? null
    : {
        providerId: "linkedin",
        name: copy.auth.providers.linkedin,
        clientId: env.LINKEDIN_CLIENT_ID,
        clientSecret: env.LINKEDIN_CLIENT_SECRET,
        discoveryUrl: linkedinDiscoveryUrl,
        scopes: ["openid", "profile", "email"],
        requireEmailVerification: true,
      };

const providerConfigs = [googleProviderConfig, linkedinProviderConfig].filter(
  (config) => config !== null,
);

export const enabledSocialProviders = providerConfigs.map((config) => config.providerId);

const ownerEmail = env.OWNER_EMAIL;

export function isAllowedEmail(email: string) {
  return isSameMailbox(email, ownerEmail);
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: AppDatabase, clock: Clock, mailSender: MailSender) {
  const adminOrigin = new URL(env.ADMIN_ORIGIN);

  const trustedOrigins = [
    ...(env.APP_ORIGIN === undefined ? [] : [env.APP_ORIGIN]),
    ...(env.AUTH_ALLOWED_HOSTS === undefined
      ? []
      : env.AUTH_ALLOWED_HOSTS.map((host) => `http://${host}:*`)),
  ];

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
        passkey: passkeys,
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
              data: {
                ...user,
                email,
                role: isSameMailbox(email, ownerEmail) ? "owner" : "user",
              },
            };

            await Promise.resolve(created);

            return created;
          },
        },
      },
    },
    socialProviders: {},
    plugins: [
      {
        id: "turnstile-gate",
        onRequest: async (request: Request) => {
          const refusal = await verifyTurnstile(request);

          return refusal === null ? undefined : { response: refusal };
        },
      },
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
      passkey({
        rpID: adminOrigin.hostname,
        rpName: copy.app.name,
        origin: [env.ADMIN_ORIGIN],
        authentication: {
          afterVerification: ({ verification }) => {
            const credentialId = verification.authenticationInfo.credentialID;

            const row = db
              .select()
              .from(passkeys)
              .where(eq(passkeys.credentialID, credentialId))
              .get();

            const userId = row?.userId;

            if (userId !== undefined) {
              recordPasskeyAssertion(db, clock, userId);
            }
          },
        },
      }),
    ],
  });
}
