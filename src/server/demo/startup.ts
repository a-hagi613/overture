import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { demoLoginEmail, demoRole } from "../../shared/demo.ts";
import { users } from "../platform/db/schema.ts";

/**
 * The production guard for `DEMO_LOGIN_ENABLED`. It refuses to start when the
 * demo email already belongs to a non-demo role (that account could send and
 * spend), and otherwise reports the guarantees the demo runs under so the line
 * is in the deploy log (#304 security review).
 * @param db The application database.
 * @param environment The `NODE_ENV` the process started with.
 * @returns The line to log when the demo is enabled, or null when it is off.
 */
export function demoStartupNotice(db: AppDatabase, environment: string) {
  const row = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, demoLoginEmail))
    .get();

  if (row !== undefined && row.role !== demoRole) {
    throw new Error(
      `DEMO_LOGIN_ENABLED is on but ${demoLoginEmail} belongs to a ${row.role} account, so the demo would not be send-safe. Fix the role or switch the flag off before starting.`,
    );
  }

  return `login enabled for ${demoLoginEmail} (${row === undefined ? "seeds on first sign-in" : "role demo"}); sends, ATS, Browser Use, outbound mail and push are blocked; sensitive routes refuse role demo; sessions last 24 h; NODE_ENV=${environment}`;
}
