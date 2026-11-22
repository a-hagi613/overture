import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { logError } from "../platform/log.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import {
  browserProfiles,
  events,
  llmUsage,
  mailboxes as mailboxRows,
  profiles,
  sessions,
  settings,
  userKeys,
  users,
} from "../platform/db/schema.ts";
import { notificationPreferencesKey } from "../../shared/notifications.ts";

export const ACCOUNT_ERASE_JOB_KIND = "account.erase";

export const ERASURE_COMPLETES_WITHIN_MS = 24 * 60 * 60 * 1000;

export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

const erasePayloadSchema = z.object({ userId: z.string().min(1) });

function objectPrefixesFor(userId: string) {
  return [`files/${userId}/`, `mail/${userId}/`, `exports/${userId}/`] as const;
}

export interface AccountEraserDeps {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  enqueueNotice: (notice: { name: string; to: string }) => Promise<void>;
  mailboxes: Pick<ReturnType<typeof createMailboxService>, "retireFor">;
  providers: BrowserProviderRegistry | null;
}

export function createAccountEraser(deps: AccountEraserDeps) {
  const { db, clock, enqueueNotice, mailboxes, objects, providers } = deps;

  async function keysUnder(prefix: string) {
    const keys: string[] = [];

    for await (const key of objects.list(prefix)) {
      keys.push(key);
    }

    return keys;
  }

  async function removeObjects(userId: string) {
    const prefixes = objectPrefixesFor(userId);
    const keys = (await Promise.all(prefixes.map(async (prefix) => keysUnder(prefix)))).flat();

    await Promise.all(keys.map(async (key) => objects.delete(key)));
  }

  function rememberProfiles(userId: string) {
    return db
      .select({
        provider: browserProfiles.provider,
        providerProfileId: browserProfiles.providerProfileId,
      })
      .from(browserProfiles)
      .where(eq(browserProfiles.userId, userId))
      .all();
  }

  async function deleteVendorProfiles(
    vendorProfiles: ReturnType<typeof rememberProfiles>,
    userId: string,
  ) {
    await Promise.all(
      vendorProfiles.map(async (profile) => {
        const provider = providers?.all().find((candidate) => candidate.id === profile.provider);

        if (provider === undefined) {
          return;
        }

        try {
          await provider.deleteProfile(profile.providerProfileId);
        } catch (error) {
          logError(`account.erase.profile ${profile.providerProfileId} (${userId})`, error);
        }
      }),
    );
  }

  async function erase(userId: string) {
    const account = db
      .select({ email: users.email, id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    const browserProfileRows = account === undefined ? [] : rememberProfiles(userId);

    await deleteVendorProfiles(browserProfileRows, userId);

    const erased =
      account === undefined
        ? false
        : db.transaction((tx) => {
            mailboxes.retireFor(userId);

            tx.delete(userKeys).where(eq(userKeys.userId, userId)).run();
            tx.delete(events).where(eq(events.userId, userId)).run();
            tx.delete(llmUsage).where(eq(llmUsage.userId, userId)).run();
            tx.delete(settings)
              .where(eq(settings.key, notificationPreferencesKey(userId)))
              .run();

            const deleted = tx
              .delete(users)
              .where(eq(users.id, userId))
              .returning({ id: users.id })
              .all();

            return deleted.length > 0;
          });

    if (account !== undefined && erased) {
      await enqueueNotice({ name: account.name, to: account.email }).catch(() => {
        logError("account.erase.confirmation", "the confirmation notice could not be queued");
      });
    }

    await removeObjects(userId);
  }

  function request(userId: string) {
    const now = clock.now();

    const job = enqueueJob(db, clock, ACCOUNT_ERASE_JOB_KIND, JSON.stringify({ userId }), {
      dedupeKey: `account.erase:${userId}`,
      maxAttempts: 5,
    });

    db.transaction((tx) => {
      tx.update(users)
        .set({ suspendedAt: new Date(now), updatedAt: new Date(now) })
        .where(eq(users.id, userId))
        .run();
      tx.update(profiles)
        .set({ running: false, pauseReason: "suspended", updatedAt: new Date(now) })
        .where(eq(profiles.userId, userId))
        .run();
      tx.update(mailboxRows).set({ status: "closed" }).where(eq(mailboxRows.userId, userId)).run();
      tx.delete(sessions).where(eq(sessions.userId, userId)).run();
    });

    return { jobId: job.id, inserted: job.inserted };
  }

  async function run(payload: string) {
    const { userId } = erasePayloadSchema.parse(JSON.parse(payload));

    await erase(userId);
  }

  return { request, run };
}

export type AccountEraser = ReturnType<typeof createAccountEraser>;
