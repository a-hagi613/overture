import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { demoRole } from "../../shared/demo.ts";
import { users } from "../platform/db/schema.ts";

/**
 * Whether a user id belongs to the demo account. Every outbound path — the
 * dispatcher, the executor, preparation, push, mail and the background sweeps —
 * asks this before it does anything for the user (#278).
 * @param db The application database.
 * @param userId The user to check.
 * @returns True only for the demo account.
 */
export function isDemoUser(db: AppDatabase, userId: string) {
  const row = db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();

  return row?.role === demoRole;
}

/**
 * Whether an email address belongs to the demo account.
 * @param db The application database.
 * @param email The address to check.
 * @returns True only for the demo account.
 */
export function isDemoUserEmail(db: AppDatabase, email: string) {
  const row = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();

  return row?.role === demoRole;
}
