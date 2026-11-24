import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { mailboxes, profiles, users } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { applyEmailInputSchema } from "../../shared/apply-alias.ts";

export interface ApplyEmailState {
  applyAddress: string | null;
  personalEmail: string;
  usePersonalEmail: boolean;
}

/**
 * The Profile → Account preference behind "Use my personal email instead" (issue #566). It lives on
 * `profiles` so every send reads one row, and saving it never rewrites the alias already assigned.
 * @param deps The database, clock and mailbox service.
 * @returns The readers and the writer the mail routes use.
 */
export function createApplyEmailService(deps: {
  db: AppDatabase;
  clock: Clock;
  mailboxes: ReturnType<typeof createMailboxService>;
}) {
  const { db, clock, mailboxes: mailboxService } = deps;

  function read(userId: string) {
    const person = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();

    const profile = db
      .select({ usePersonalEmail: profiles.usePersonalEmail })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    const mailbox = db
      .select({ applyAddress: mailboxes.applyAddress })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .get();

    return {
      applyAddress: mailbox?.applyAddress ?? null,
      personalEmail: person?.email ?? "",
      usePersonalEmail: profile?.usePersonalEmail ?? false,
    } satisfies ApplyEmailState;
  }

  async function ensure(userId: string, mayWrite: boolean) {
    if (mayWrite) {
      await mailboxService.ensureFor(userId);
    }

    return read(userId);
  }

  async function save(userId: string, input: { usePersonalEmail: boolean }) {
    const { usePersonalEmail } = applyEmailInputSchema.parse(input);
    const at = new Date(clock.now());

    await db
      .insert(profiles)
      .values({
        userId,
        usePersonalEmail,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { usePersonalEmail, updatedAt: at },
      });

    publishEvent(db, clock, "profile.updated", JSON.stringify({ applyEmail: true }), userId);

    return read(userId);
  }

  return { ensure, read, save };
}
