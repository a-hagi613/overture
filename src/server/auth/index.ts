import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { genericOAuth, magicLink } from "better-auth/plugins";
import type { GenericOAuthUserInfo } from "better-auth/plugins/generic-oauth";
import { passkey } from "@better-auth/passkey";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { copy } from "../../shared/copy.ts";
import {
  authSecretConfig,
  betterAuthSecretOptions,
  env,
  sessionCookieOptions,
} from "../config/env.ts";
import {
  accounts,
  passkeys,
  rateLimits,
  sessions,
  users,
  verifications,
} from "../platform/db/schema.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { recordPasskeyAssertion } from "../platform/passkey/index.ts";
import { magicLinkEmail } from "../platform/mail/emails.ts";
import { isSameMailbox } from "./email.ts";
import { isDemoAllowedAuthPath } from "./demo-paths.ts";
import {
  acceptInvite,
  deleteUnverifiedUserWithEmail,
  isSuspendedUser,
  liveInviteFor,
  pendingInviteFor,
  suspendedUserWithEmail,
  verifiedUserWithEmail,
} from "./invites.ts";
import { verifyTurnstile } from "./turnstile-gate.ts";
import { markWaitlistJoined } from "../waitlist/store.ts";
import { clientIpHeaders } from "./client-ip.ts";
import { trustedOriginsFor } from "./trusted-origins.ts";
import { demoLoginPlugin, DEMO_SESSION_MS } from "./demo-login.ts";
import { isDemoUser } from "../demo/role.ts";

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

const providerProfileSchema = z.looseObject({
  email: z.string().min(1),
  emailVerified: z.union([z.literal(true), z.literal("true")]),
});

function withPreHijackGuard<T>(
  config: T,
  discardUnverifiedAccount: (email: string) => Promise<void>,
) {
  return {
    ...config,
    mapProfileToUser: async (profile: GenericOAuthUserInfo) => {
      const verified = providerProfileSchema.safeParse(profile);

      if (verified.success) {
        await discardUnverifiedAccount(verified.data.email);
      }

      return {};
    },
  };
}

export const enabledSocialProviders = providerConfigs.map((config) => config.providerId);

const ownerEmail = env.OWNER_EMAIL;

const inviteHashSecrets = authSecretConfig.accepted;

/**
 * Whether an address belongs to the single owner account the admin host trusts.
 * @param email The address to compare, in any case.
 * @returns True when the address is the owner's mailbox.
 */
export function isOwnerEmail(email: string) {
  return isSameMailbox(email, ownerEmail);
}

/**
 * Whether an address may sign up while public sign-up is off: the owner or a
 * deliberately allowlisted tester. Allowlisted addresses never become owners.
 * @param email The address to compare, in any case.
 * @returns True when the address may create an account without an invite.
 */
export function isAllowedEmail(email: string) {
  return (
    isOwnerEmail(email) ||
    env.ALLOWED_SIGNUP_EMAILS.some((allowed) => isSameMailbox(email, allowed))
  );
}

export type Auth = ReturnType<typeof createAuth>;

export interface AuthOptions {
  onUserCreated?: (user: { id: string; email: string }) => Promise<void> | void;
  ensureDemoUser?: () => Promise<string>;
}

export function createAuth(
  db: AppDatabase,
  clock: Clock,
  mailSender: MailSender,
  options: AuthOptions = {},
) {
  const adminOrigin = new URL(env.ADMIN_ORIGIN);

  const mayJoin = (email: string) =>
    env.PUBLIC_SIGNUP_ENABLED ||
    isAllowedEmail(email) ||
    liveInviteFor(db, inviteHashSecrets, email) !== null ||
    verifiedUserWithEmail(db, email) !== null;

  const discardUnverifiedAccount = async (email: string) => {
    const address = email.trim().toLowerCase();

    await retryWhenBusy(
      () =>
        db.transaction((tx) => {
          const user = tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.email, address),
                eq(users.emailVerified, false),
                isNull(users.suspendedAt),
              ),
            )
            .get();

          if (user === undefined) {
            return;
          }

          const linked = tx
            .select({ providerId: accounts.providerId })
            .from(accounts)
            .where(eq(accounts.userId, user.id))
            .all();

          const signedIn =
            tx
              .select({ id: sessions.id })
              .from(sessions)
              .where(eq(sessions.userId, user.id))
              .get() !== undefined;

          if (signedIn || linked.some((account) => account.providerId !== "credential")) {
            return;
          }

          tx.delete(users).where(eq(users.id, user.id)).run();
          tx.delete(verifications).where(eq(verifications.identifier, address)).run();
        }),
      "auth.discard-unverified",
    );
  };

  const trustedOrigins = trustedOriginsFor({
    appOrigin: env.APP_ORIGIN,
    adminOrigin: env.ADMIN_ORIGIN,
    allowedHosts: env.AUTH_ALLOWED_HOSTS,
  });

  return betterAuth({
    appName: copy.app.name,
    baseURL:
      env.APP_ORIGIN === undefined
        ? {
            allowedHosts: env.AUTH_ALLOWED_HOSTS?.map((host) => `${host}:*`) ?? [
              "127.0.0.1:*",
              "localhost:*",
            ],
          }
        : {
            allowedHosts: [
              ...new Set([new URL(env.APP_ORIGIN).host, new URL(env.ADMIN_ORIGIN).host]),
            ],
            fallback: env.APP_ORIGIN,
            protocol: new URL(env.APP_ORIGIN).protocol === "https:" ? "https" : "http",
          },
    trustedOrigins,
    advanced: {
      ...sessionCookieOptions(env.NODE_ENV),
      ipAddress: {
        ipAddressHeaders: clientIpHeaders({
          flyAppName: env.FLY_APP_NAME,
          nodeEnv: env.NODE_ENV,
        }),
      },
    },
    ...betterAuthSecretOptions(authSecretConfig),
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
        requireLocalEmailVerified: true,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        await Promise.resolve();

        const { path } = context;

        if (isDemoAllowedAuthPath(path)) {
          return;
        }

        const session = await getSessionFromCtx(context).catch(() => null);

        if (session !== null && isDemoUser(db, session.user.id)) {
          throw new APIError("FORBIDDEN", {
            code: "demo_locked",
            message: copy.demo.locked,
          });
        }
      }),
      after: createAuthMiddleware(async (context) => {
        await Promise.resolve();

        if (context.path !== "/get-session") {
          return;
        }

        const current = context.context.newSession;

        if (current === null) {
          return;
        }

        if (!isDemoUser(db, current.session.userId)) {
          return;
        }

        const limit = current.session.createdAt.getTime() + DEMO_SESSION_MS;

        if (current.session.expiresAt.getTime() <= limit) {
          return;
        }

        const expiresAt = new Date(limit);

        context.context.setNewSession({
          session: { ...current.session, expiresAt },
          user: current.user,
        });

        db.update(sessions).set({ expiresAt }).where(eq(sessions.id, current.session.id)).run();
      }),
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/magic-link": { window: 15 * 60, max: 3 },
        "/demo/sign-in": { window: 15 * 60, max: 3 },
        "/sign-in/oauth2": { window: 15 * 60, max: 10 },
        "/sign-in/social": { window: 15 * 60, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = user.email.trim().toLowerCase();

            if (!mayJoin(email) || verifiedUserWithEmail(db, email) !== null) {
              throw new APIError("FORBIDDEN", {
                code: "forbidden",
                message: copy.auth.accountRefused,
              });
            }

            if (suspendedUserWithEmail(db, email)) {
              throw new APIError("FORBIDDEN", {
                code: "account_suspended",
                message: copy.auth.accountSuspended,
              });
            }

            deleteUnverifiedUserWithEmail(db, email);

            const created = {
              data: {
                ...user,
                email,
                role: isOwnerEmail(email) ? "owner" : "user",
              },
            };

            await Promise.resolve(created);

            return created;
          },
          after: async (user) => {
            const email = user.email.trim().toLowerCase();

            const invite = user.emailVerified
              ? pendingInviteFor(db, inviteHashSecrets, email)
              : null;

            await options.onUserCreated?.({ id: user.id, email: user.email });
            await Promise.resolve(invite);

            if (!user.emailVerified || isOwnerEmail(email)) {
              return;
            }

            markWaitlistJoined(db, clock, email);

            const accepted = invite === null ? null : acceptInvite(db, clock, invite, user.id);

            if (accepted !== null || env.PUBLIC_SIGNUP_ENABLED || isAllowedEmail(email)) {
              return;
            }

            db.delete(users).where(eq(users.id, user.id)).run();

            throw new APIError("FORBIDDEN", {
              code: "forbidden",
              message: copy.auth.accountRefused,
            });
          },
        },
        update: {
          after: async (user) => {
            const email = user.email.trim().toLowerCase();

            const invite = user.emailVerified
              ? pendingInviteFor(db, inviteHashSecrets, email)
              : null;

            await Promise.resolve(invite);

            if (user.emailVerified && !isOwnerEmail(email)) {
              markWaitlistJoined(db, clock, email);
            }

            if (invite !== null && !isOwnerEmail(email)) {
              acceptInvite(db, clock, invite, user.id);
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const suspended = isSuspendedUser(db, session.userId);

            await Promise.resolve(suspended);

            if (suspended) {
              throw new APIError("FORBIDDEN", {
                code: "account_suspended",
                message: copy.auth.accountSuspended,
              });
            }
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
        config: providerConfigs.map((config) =>
          withPreHijackGuard(config, discardUnverifiedAccount),
        ),
      }),
      magicLink({
        expiresIn: 15 * 60,
        rateLimit: { window: 15 * 60, max: 3 },
        disableSignUp: false,
        storeToken: "hashed",
        sendMagicLink: async (data) => {
          const email = data.email.trim().toLowerCase();

          if (!mayJoin(email)) {
            throw new APIError("FORBIDDEN", {
              code: "forbidden",
              message: copy.auth.accountRefused,
            });
          }

          if (suspendedUserWithEmail(db, email)) {
            throw new APIError("FORBIDDEN", {
              code: "account_suspended",
              message: copy.auth.accountSuspended,
            });
          }

          await mailSender.sendMagicLink({ to: email, ...magicLinkEmail(data.url) });
        },
      }),
      ...(env.DEMO_LOGIN_ENABLED && options.ensureDemoUser !== undefined
        ? [
            demoLoginPlugin({
              clock,
              db,
              ensureDemoUser: options.ensureDemoUser,
            }),
          ]
        : []),
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
