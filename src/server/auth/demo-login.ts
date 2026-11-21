import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { copy } from "../../shared/copy.ts";
import { isDemoEmail } from "../../shared/demo.ts";
import { sessions } from "../platform/db/schema.ts";

export const DEMO_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * How many visitors may hold a demo session at once. The oldest is evicted when
 * another signs in, so the demo box never grows without bound (#304 security
 * review).
 */
export const DEMO_SESSION_LIMIT = 20;

const bodySchema = z.object({ email: z.string().min(1).max(320) });

export interface DemoLoginDeps {
  clock: Clock;
  db: AppDatabase;
  ensureDemoUser: () => Promise<string>;
}

/**
 * A one-click sign-in for the demo account, on the sign-in page's magic-link
 * field. It only exists when `DEMO_LOGIN_ENABLED=true`, only accepts the demo
 * email, creates a 24 h session without sending any mail, and keeps at most
 * `DEMO_SESSION_LIMIT` concurrent sessions by evicting the oldest.
 * @param deps The clock and the seeder that keeps the demo account idempotent.
 * @returns The better-auth plugin that serves `POST /api/auth/demo/sign-in`.
 */
export function demoLoginPlugin(deps: DemoLoginDeps) {
  return {
    id: "demo-login",
    endpoints: {
      demoSignIn: createAuthEndpoint(
        "/demo/sign-in",
        { body: bodySchema, method: "POST" },
        async (context) => {
          if (!isDemoEmail(context.body.email)) {
            throw new APIError("FORBIDDEN", {
              code: "forbidden",
              message: copy.auth.accountRefused,
            });
          }

          const userId = await deps.ensureDemoUser();

          const user = await context.context.internalAdapter.findUserById(userId);

          if (user === null) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              code: "demo_user_missing",
              message: copy.signIn.genericError,
            });
          }

          const session = await context.context.internalAdapter.createSession(userId, false);

          const oldest = deps.db
            .select({ id: sessions.id })
            .from(sessions)
            .where(and(eq(sessions.userId, userId), ne(sessions.id, session.id)))
            .orderBy(asc(sessions.createdAt), asc(sessions.id))
            .all();

          const overflow = oldest.length - (DEMO_SESSION_LIMIT - 1);

          if (overflow > 0) {
            deps.db
              .delete(sessions)
              .where(
                inArray(
                  sessions.id,
                  oldest.slice(0, overflow).map((row) => row.id),
                ),
              )
              .run();
          }

          const expiresAt = new Date(deps.clock.now() + DEMO_SESSION_MS);

          deps.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.id)).run();

          await setSessionCookie(context, { session: { ...session, expiresAt }, user }, false, {
            maxAge: DEMO_SESSION_MS / 1000,
          });

          return context.json({ ok: true, userId });
        },
      ),
    },
  };
}
