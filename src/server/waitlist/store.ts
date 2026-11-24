import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { waitlistEntries } from "../platform/db/schema.ts";
import type { WaitlistFilter, WaitlistOrder } from "../../shared/waitlist.ts";

export type WaitlistEntryRow = typeof waitlistEntries.$inferSelect;

export function normaliseWaitlistEmail(email: string) {
  return email.trim().toLowerCase();
}

function textOrNull(value: string | undefined) {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

export interface WaitlistSubmission {
  email: string;
  targetLocation?: string | undefined;
  targetRole?: string | undefined;
}

/**
 * Records one waitlist submission without ever creating a second row for the same email.
 *
 * A repeat submission of a pending or invited entry refreshes the role, location and `updated_at`, and leaves the
 * status alone. A joined entry is never reset to pending, so the queue cannot take a real account backwards. The
 * caller always answers with the same friendly confirmation, so the endpoint never reveals whether the email was
 * already known.
 * @param db The application database.
 * @param clock The clock the submission times are read from.
 * @param submission The validated, normalized submission.
 * @returns The stored row after the write.
 */
export function recordWaitlistEntry(db: AppDatabase, clock: Clock, submission: WaitlistSubmission) {
  const email = normaliseWaitlistEmail(submission.email);
  const now = clock.now();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, email))
      .get();

    if (existing === undefined) {
      const row = {
        id: crypto.randomUUID(),
        email,
        targetRole: textOrNull(submission.targetRole),
        targetLocation: textOrNull(submission.targetLocation),
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
        invitedAt: null,
      };

      tx.insert(waitlistEntries).values(row).run();

      return row;
    }

    if (existing.status === "joined") {
      return existing;
    }

    tx.update(waitlistEntries)
      .set({
        targetRole: textOrNull(submission.targetRole),
        targetLocation: textOrNull(submission.targetLocation),
        updatedAt: now,
      })
      .where(eq(waitlistEntries.id, existing.id))
      .run();

    const updated = tx
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.id, existing.id))
      .get();

    return updated ?? existing;
  });
}

/**
 * Moves a waitlist entry to `joined` when its email finishes account creation. It is a no-op for an email that never
 * joined the list, and it never touches a row that is already joined.
 * @param db The application database.
 * @param clock The clock the update time is read from.
 * @param email The verified account email.
 * @returns Nothing.
 */
export function markWaitlistJoined(db: AppDatabase, clock: Clock, email: string) {
  const address = normaliseWaitlistEmail(email);

  db.update(waitlistEntries)
    .set({ status: "joined", updatedAt: clock.now() })
    .where(and(eq(waitlistEntries.email, address), ne(waitlistEntries.status, "joined")))
    .run();
}

/**
 * Moves an entry to `invited` after an admin sends its single-use invite.
 * @param db The application database.
 * @param clock The clock the invite time is read from.
 * @param id The waitlist entry id.
 * @returns The updated row, or null when it does not exist.
 */
export function markWaitlistInvited(db: AppDatabase, clock: Clock, id: string) {
  const now = clock.now();

  const updated = db
    .update(waitlistEntries)
    .set({ status: "invited", invitedAt: now, updatedAt: now })
    .where(and(eq(waitlistEntries.id, id), ne(waitlistEntries.status, "joined")))
    .returning()
    .all();

  if (updated.length > 0) {
    return updated[0] ?? null;
  }

  return db.select().from(waitlistEntries).where(eq(waitlistEntries.id, id)).get() ?? null;
}

/**
 * Reads one waitlist row without changing it.
 * @param db The application database.
 * @param id The waitlist entry id.
 * @returns The row, or null.
 */
export function waitlistEntryById(db: AppDatabase, id: string) {
  return db.select().from(waitlistEntries).where(eq(waitlistEntries.id, id)).get() ?? null;
}

export function waitlistCounts(db: AppDatabase) {
  const rows = db
    .select({ status: waitlistEntries.status, total: sql<number>`count(*)` })
    .from(waitlistEntries)
    .groupBy(waitlistEntries.status)
    .all();

  const counts = { all: 0, pending: 0, invited: 0, joined: 0 };

  for (const row of rows) {
    const { total } = row;

    counts[row.status] = total;
    counts.all += total;
  }

  return counts;
}

/**
 * Lists the admin queue: an optional status filter, an optional search across the email, role and location, and the
 * newest or oldest first.
 * @param db The application database.
 * @param query The status filter, search text and order.
 * @returns The matching rows.
 */
export function waitlistEntriesFor(
  db: AppDatabase,
  query: { order: WaitlistOrder; q: string; status: WaitlistFilter },
) {
  const needle = query.q.trim().toLowerCase();
  const conditions = [];

  if (query.status !== "all") {
    conditions.push(eq(waitlistEntries.status, query.status));
  }

  if (needle.length > 0) {
    const pattern = `%${needle}%`;

    conditions.push(
      sql`(lower(${waitlistEntries.email}) like ${pattern} or lower(coalesce(${waitlistEntries.targetRole}, '')) like ${pattern} or lower(coalesce(${waitlistEntries.targetLocation}, '')) like ${pattern})`,
    );
  }

  const order = query.order === "oldest" ? asc : desc;

  return db
    .select()
    .from(waitlistEntries)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(order(waitlistEntries.createdAt), order(waitlistEntries.id))
    .limit(500)
    .all();
}
