import { createHmac } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { grantApplications } from "../billing/ledger.ts";
import { invites, users } from "../platform/db/schema.ts";
import { getSettingNumber } from "../platform/settings/index.ts";

import type { SETTING_DEFAULTS } from "../platform/settings/index.ts";
import { normaliseEmail } from "./email.ts";

export const INVITE_GRANT_QUANTITY_KEY =
  "invite.grant_quantity" satisfies keyof typeof SETTING_DEFAULTS;

export const INVITE_GRANT_DAYS_KEY = "invite.grant_days" satisfies keyof typeof SETTING_DEFAULTS;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InviteRow = typeof invites.$inferSelect;

export function inviteEmailHash(secret: string, email: string) {
  return createHmac("sha256", secret).update(normaliseEmail(email)).digest("hex");
}

export function findInvite(db: AppDatabase, secret: string, email: string) {
  return (
    db
      .select()
      .from(invites)
      .where(eq(invites.emailHash, inviteEmailHash(secret, email)))
      .get() ?? null
  );
}

export function inviteStatus(invite: InviteRow) {
  if (invite.acceptedAt !== null) {
    return "accepted";
  }

  return invite.revokedAt === null ? "pending" : "revoked";
}

export function liveInviteFor(db: AppDatabase, secret: string, email: string) {
  const invite = findInvite(db, secret, email);

  if (invite === null) {
    return null;
  }

  return invite.revokedAt === null ? invite : null;
}

export function pendingInviteFor(db: AppDatabase, secret: string, email: string) {
  const invite = liveInviteFor(db, secret, email);

  if (invite === null) {
    return null;
  }

  return invite.acceptedAt === null ? invite : null;
}

export function suspendedUserWithEmail(db: AppDatabase, email: string) {
  const user = db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();

  return user !== undefined && user.suspendedAt !== null;
}

export function isSuspendedUser(db: AppDatabase, userId: string) {
  const user = db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return user !== undefined && user.suspendedAt !== null;
}

export function acceptInvite(db: AppDatabase, clock: Clock, invite: InviteRow, userId: string) {
  const at = clock.now();

  const quantity = getSettingNumber(db, INVITE_GRANT_QUANTITY_KEY, {
    integer: true,
    minimum: 1,
  });

  const days = getSettingNumber(db, INVITE_GRANT_DAYS_KEY, { integer: true, minimum: 1 });

  return db.transaction((tx) => {
    const claimed = tx
      .update(invites)
      .set({ acceptedAt: new Date(at), acceptedUserId: userId })
      .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .returning({ id: invites.id })
      .all();

    if (claimed.length === 0) {
      return null;
    }

    const grant = grantApplications(tx, clock, {
      userId,
      source: "admin",
      quantity,
      startsAt: at,
      expiresAt: at + days * DAY_MS,
      idempotencyKey: `invite-grant:${invite.id}`,
    });

    tx.update(invites).set({ grantId: grant.grantId }).where(eq(invites.id, invite.id)).run();

    return { grantId: grant.grantId };
  });
}
