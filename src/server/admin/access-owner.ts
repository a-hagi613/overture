import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { CloudflareAccessIdentity } from "../platform/access/index.ts";

import { isOwnerEmail } from "../auth/index.ts";
import { normaliseEmail } from "../auth/email.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { users } from "../platform/db/schema.ts";

const OWNER_REQUIRED = { code: "owner_required", ok: false } as const;

type UserRow = typeof users.$inferSelect;

/**
 * A display name from the local part of an address, so a fresh owner row is
 * never blank. Dots, underscores, pluses and dashes read as spaces.
 * @param email The normalized address.
 * @returns A short, human name such as "Maya Okafor".
 */
export function nameFromEmail(email: string) {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);

  const words = local
    .split(/[._+-]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`);

  return words.length === 0 ? email : words.join(" ");
}

function findUser(db: AppDatabase, email: string) {
  const exact = db.select().from(users).where(eq(users.email, email)).get();

  if (exact !== undefined) {
    return exact;
  }

  return (
    db
      .select()
      .from(users)
      .where(eq(users.mailbox, normaliseEmail(email)))
      .get() ?? null
  );
}

function promote(db: AppDatabase, row: UserRow, at: Date) {
  const next: Partial<typeof users.$inferInsert> = { updatedAt: at };

  if (row.role !== "owner") {
    next.role = "owner";
  }

  if (!row.emailVerified) {
    next.emailVerified = true;
  }

  db.update(users).set(next).where(eq(users.id, row.id)).run();
}

/**
 * Resolves the admin owner from a verified Cloudflare Access identity.
 *
 * Cloudflare Access is the only admin gate, so this creates or promotes the
 * owner row the admin API, Reveal and `/api/me` then use. A non-owner or a
 * suspended owner is refused with `owner_required`; nothing else may hold the
 * portal.
 * @param db The application database.
 * @param clock The clock the new row and audit-friendly timestamps use.
 * @param identity The verified Access identity (`email` and `sub`).
 * @returns The owner context, or the refusal code when the address is not the owner.
 */
export async function resolveAdminAccessOwner(
  db: AppDatabase,
  clock: Clock,
  identity: CloudflareAccessIdentity,
) {
  const email = normaliseEmail(identity.email);

  if (!isOwnerEmail(email)) {
    return OWNER_REQUIRED;
  }

  const existing = findUser(db, email);

  if (existing !== null) {
    if (existing.suspendedAt !== null) {
      return OWNER_REQUIRED;
    }

    if (existing.role !== "owner" || !existing.emailVerified) {
      promote(db, existing, new Date(clock.now()));
    }

    return { ok: true, owner: { email: existing.email, userId: existing.id } };
  }

  const at = new Date(clock.now());

  await retryWhenBusy(
    () =>
      db
        .insert(users)
        .values({
          createdAt: at,
          email,
          emailVerified: true,
          id: randomUUID(),
          name: nameFromEmail(email),
          role: "owner",
          updatedAt: at,
        })
        .onConflictDoNothing()
        .run(),
    "admin.access-owner",
  );

  const created = findUser(db, email);

  if (created === null) {
    return OWNER_REQUIRED;
  }

  if (created.suspendedAt !== null) {
    return OWNER_REQUIRED;
  }

  if (created.role !== "owner" || !created.emailVerified) {
    promote(db, created, at);
  }

  return { ok: true, owner: { email: created.email, userId: created.id } };
}
