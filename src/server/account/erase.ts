import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { logError } from "../platform/log.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { RetryLaterError } from "../platform/jobs/retry.ts";
import {
  accountErasures,
  bgJobs,
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
import { ACCOUNT_DELETED_NOTICE_JOB_KIND } from "./notice.ts";

export const ACCOUNT_ERASE_JOB_KIND = "account.erase";

export const ERASURE_COMPLETES_WITHIN_MS = 24 * 60 * 60 * 1000;

export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

/**
 * How long a failed external cleanup waits before the erase job is retried. The job is requeued
 * without consuming an attempt ({@link RetryLaterError}), so a vendor outage keeps retrying until
 * both the vendor profiles and the stored objects are confirmed gone.
 */
export const ERASURE_RETRY_DELAY_MS = 60_000;

const erasePayloadSchema = z.object({ userId: z.string().min(1) });

const vendorProfileSchema = z.object({
  provider: z.enum(["browser_use", "kernel", "local"]),
  providerProfileId: z.string().min(1),
});

const vendorProfilesSchema = z.array(vendorProfileSchema);

const objectPrefixesSchema = z.array(z.string().min(1)).min(1);

type VendorProfile = z.infer<typeof vendorProfileSchema>;

type AccountErasure = typeof accountErasures.$inferSelect;

function objectPrefixesFor(userId: string) {
  return [`files/${userId}/`, `mail/${userId}/`, `exports/${userId}/`] as const;
}

function parseVendorProfiles(raw: string) {
  return vendorProfilesSchema.parse(JSON.parse(raw));
}

function parseObjectPrefixes(raw: string) {
  return objectPrefixesSchema.parse(JSON.parse(raw));
}

const missingProfileErrorSchema = z.object({ status: z.literal(404) });

function isMissingAtVendor(error: Error) {
  return missingProfileErrorSchema.safeParse(error).success;
}

export interface AccountEraserDeps {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  sealNotice: (notice: { name: string; to: string }) => Promise<string>;
  mailboxes: Pick<ReturnType<typeof createMailboxService>, "retireFor">;
  providers: BrowserProviderRegistry | null;
}

export function createAccountEraser(deps: AccountEraserDeps) {
  const { db, clock, mailboxes, objects, providers, sealNotice } = deps;

  function recordFor(userId: string) {
    return db.select().from(accountErasures).where(eq(accountErasures.userId, userId)).get();
  }

  function noticeJobFor(userId: string) {
    return db
      .select({ id: bgJobs.id })
      .from(bgJobs)
      .where(eq(bgJobs.dedupeKey, `${ACCOUNT_DELETED_NOTICE_JOB_KIND}:${userId}`))
      .get();
  }

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

  function saveVendorProfiles(userId: string, vendorProfiles: readonly VendorProfile[]) {
    const now = clock.now();
    const clean = vendorProfiles.length === 0;

    db.update(accountErasures)
      .set({
        updatedAt: new Date(now),
        vendorProfiles: JSON.stringify(vendorProfiles),
        ...(clean && { vendorCleanedAt: new Date(now) }),
      })
      .where(eq(accountErasures.userId, userId))
      .run();
  }

  function recordFailure(userId: string, message: string) {
    db.update(accountErasures)
      .set({ lastError: message, updatedAt: new Date(clock.now()) })
      .where(eq(accountErasures.userId, userId))
      .run();
  }

  function prepare(userId: string) {
    const existing = recordFor(userId);

    if (existing !== undefined) {
      return existing;
    }

    const account = db
      .select({ email: users.email, id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (account === undefined) {
      return null;
    }

    const vendorProfiles = rememberProfiles(userId);
    const now = clock.now();

    db.transaction((tx) => {
      tx.insert(accountErasures)
        .values({
          createdAt: new Date(now),
          lastError: null,
          noticeName: account.name,
          noticeTo: account.email,
          objectPrefixes: JSON.stringify([...objectPrefixesFor(userId)]),
          updatedAt: new Date(now),
          userDeletedAt: new Date(now),
          userId,
          vendorProfiles: JSON.stringify(vendorProfiles),
        })
        .run();

      mailboxes.retireFor(userId);

      tx.delete(userKeys).where(eq(userKeys.userId, userId)).run();
      tx.delete(events).where(eq(events.userId, userId)).run();
      tx.delete(llmUsage).where(eq(llmUsage.userId, userId)).run();
      tx.delete(settings)
        .where(eq(settings.key, notificationPreferencesKey(userId)))
        .run();

      tx.delete(users).where(eq(users.id, userId)).run();
    });

    return recordFor(userId) ?? null;
  }

  async function cleanVendorProfiles(record: AccountErasure) {
    if (record.vendorCleanedAt !== null) {
      return;
    }

    const vendorProfiles = parseVendorProfiles(record.vendorProfiles);

    const results = await Promise.all(
      vendorProfiles.map(async (profile) => {
        const provider = providers?.all().find((candidate) => candidate.id === profile.provider);

        if (provider === undefined) {
          return profile.provider === "local"
            ? null
            : `the ${profile.provider} provider is not configured; profile ${profile.providerProfileId} is still at the vendor`;
        }

        try {
          await provider.deleteProfile(profile.providerProfileId);

          return null;
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));

          logError("account.erase.profile", cause);

          return isMissingAtVendor(cause)
            ? null
            : `deleteProfile ${profile.provider} ${profile.providerProfileId} failed: ${cause.message}`;
        }
      }),
    );

    const failures = results.flatMap((result) => (result === null ? [] : [result]));

    if (failures.length > 0) {
      const message = failures.join("; ");
      const remaining = vendorProfiles.filter((_, index) => results[index] !== null);

      saveVendorProfiles(record.userId, remaining);
      recordFailure(record.userId, message);

      throw new RetryLaterError(message, ERASURE_RETRY_DELAY_MS);
    }

    saveVendorProfiles(record.userId, []);
  }

  async function cleanObjects(record: AccountErasure) {
    if (record.objectsCleanedAt !== null) {
      return;
    }

    const prefixes = parseObjectPrefixes(record.objectPrefixes);

    const listings = await Promise.all(
      prefixes.map(async (prefix) => {
        try {
          return { error: null, keys: await keysUnder(prefix), prefix };
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));

          logError("account.erase.objects", cause);

          return { error: `listing ${prefix} failed: ${cause.message}`, keys: [], prefix };
        }
      }),
    );

    const deletions = await Promise.all(
      listings.flatMap((listing) =>
        listing.keys.map(async (key) => {
          try {
            await objects.delete(key);

            return null;
          } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error));

            logError("account.erase.objects", cause);

            return `deleting ${key} failed: ${cause.message}`;
          }
        }),
      ),
    );

    const verifications = await Promise.all(
      prefixes.map(async (prefix) => {
        try {
          return { error: null, prefix, remaining: (await keysUnder(prefix)).length };
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));

          logError("account.erase.objects", cause);

          return { error: `listing ${prefix} failed: ${cause.message}`, prefix, remaining: 0 };
        }
      }),
    );

    const failures = [
      ...listings.flatMap((listing) => (listing.error === null ? [] : [listing.error])),
      ...deletions.flatMap((failure) => (failure === null ? [] : [failure])),
      ...verifications.flatMap((verification) => {
        if (verification.error !== null) {
          return [verification.error];
        }

        if (verification.remaining > 0) {
          return [
            `object prefix ${verification.prefix} still lists ${String(verification.remaining)} objects after deletion`,
          ];
        }

        return [];
      }),
    ];

    if (failures.length > 0) {
      const message = `object cleanup failed: ${failures.join("; ")}`;

      recordFailure(record.userId, message);

      throw new RetryLaterError(message, ERASURE_RETRY_DELAY_MS);
    }

    const now = clock.now();

    db.update(accountErasures)
      .set({ objectsCleanedAt: new Date(now), updatedAt: new Date(now) })
      .where(eq(accountErasures.userId, record.userId))
      .run();
  }

  async function queueNotice(record: AccountErasure) {
    if (record.noticeQueuedAt !== null) {
      return;
    }

    const { noticeName: name, noticeTo: to } = record;

    if (name === null || to === null) {
      const now = clock.now();

      db.update(accountErasures)
        .set({ noticeQueuedAt: new Date(now), updatedAt: new Date(now) })
        .where(eq(accountErasures.userId, record.userId))
        .run();

      return;
    }

    try {
      const payload = await sealNotice({ name, to });

      if (noticeJobFor(record.userId) === undefined) {
        enqueueJob(db, clock, ACCOUNT_DELETED_NOTICE_JOB_KIND, payload, {
          dedupeKey: `${ACCOUNT_DELETED_NOTICE_JOB_KIND}:${record.userId}`,
          maxAttempts: 5,
        });
      }

      const now = clock.now();

      db.update(accountErasures)
        .set({
          lastError: null,
          noticeName: null,
          noticeQueuedAt: new Date(now),
          noticeTo: null,
          updatedAt: new Date(now),
        })
        .where(eq(accountErasures.userId, record.userId))
        .run();
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      const message = `the confirmation notice could not be queued: ${cause.message}`;
      const failure = new RetryLaterError(message, ERASURE_RETRY_DELAY_MS);

      logError("account.erase.confirmation", cause);
      recordFailure(record.userId, message);

      throw failure;
    }
  }

  async function erase(userId: string) {
    const prepared = prepare(userId);

    if (prepared === null) {
      try {
        await removeObjects(userId);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));

        logError("account.erase.objects", cause);

        throw new RetryLaterError(
          `object cleanup failed: ${cause.message}`,
          ERASURE_RETRY_DELAY_MS,
        );
      }

      return;
    }

    if (prepared.noticeQueuedAt !== null) {
      return;
    }

    const results = await Promise.allSettled([
      cleanVendorProfiles(recordFor(userId) ?? prepared),
      cleanObjects(recordFor(userId) ?? prepared),
    ]);

    const unexpected = results.find(
      (result) => result.status === "rejected" && !(result.reason instanceof RetryLaterError),
    );

    if (unexpected?.status === "rejected") {
      throw unexpected.reason;
    }

    const failures = results.flatMap((result) =>
      result.status === "rejected" && result.reason instanceof RetryLaterError
        ? [result.reason.message]
        : [],
    );

    if (failures.length > 0) {
      throw new RetryLaterError(failures.join("; "), ERASURE_RETRY_DELAY_MS);
    }

    const current = recordFor(userId);

    if (current === undefined) {
      return;
    }

    if (current.vendorCleanedAt === null || current.objectsCleanedAt === null) {
      throw new RetryLaterError(
        "the external cleanup did not confirm clean",
        ERASURE_RETRY_DELAY_MS,
      );
    }

    await queueNotice(current);
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
