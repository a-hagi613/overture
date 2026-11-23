import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";

import { BrowserUseClient } from "../dispatch/browser/browser-use.ts";
import { createBrowserUseBrowserProvider } from "../dispatch/browser/browser-use-provider.ts";
import { createBrowserProfileStore } from "../dispatch/browser/profiles.ts";
import { createMailboxService } from "../inbox/mailboxes.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { RetryLaterError } from "../platform/jobs/retry.ts";
import { runDueJobs } from "../platform/jobs/run-due.ts";
import {
  accountErasures,
  bgJobs,
  browserProfiles,
  mailboxes,
  retiredAddresses,
  users,
} from "../platform/db/schema.ts";
import { ACCOUNT_ERASE_JOB_KIND, ERASURE_RETRY_DELAY_MS, createAccountEraser } from "./erase.ts";
import { ACCOUNT_DELETED_NOTICE_JOB_KIND, createDeletionNoticeCrypto } from "./notice.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

const USER_ID = "user-erase-1";
const PROFILE_ID = "vendor-profile-1";
const MAILBOX_LOCAL_PART = "in-erase-test";
const OBJECT_PREFIXES = ["files", "mail", "exports"] as const;

const OBJECT_KEYS = [
  `files/${USER_ID}/resume.pdf`,
  `mail/${USER_ID}/letter.pdf`,
  `exports/${USER_ID}/data.zip`,
];

const payload = JSON.stringify({ userId: USER_ID });

const storedVendorProfilesSchema = z.array(
  z.object({ provider: z.string(), providerProfileId: z.string() }),
);

interface ProfileFixture {
  url: string;
  deleted: string[];
  close: () => void;
}

function profileFixture(options: { failures?: number; status?: number } = {}) {
  const deleted: string[] = [];
  let remaining = options.failures ?? 0;

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const prefix = "/api/v4/profiles/";

      if (request.method === "DELETE" && url.pathname.startsWith(prefix)) {
        if (remaining > 0) {
          remaining -= 1;

          return new Response("the profile could not be deleted", {
            status: options.status ?? 500,
          });
        }

        deleted.push(url.pathname.slice(prefix.length));

        return new Response(null, { status: 204 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    close: () => {
      void server.stop(true);
    },
    deleted,
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies ProfileFixture;
}

function providersFor(account: AccountFixture, fixture: ProfileFixture) {
  const provider = createBrowserUseBrowserProvider({
    client: BrowserUseClient("test-key", fixture.url, account.clock),
    clock: account.clock,
    profiles: createBrowserProfileStore(account.db, account.clock),
  });

  return {
    all: () => [provider],
    ids: () => [provider.id],
    pick: () => provider,
  } satisfies BrowserProviderRegistry;
}

interface AccountFixture {
  db: ReturnType<typeof openDatabase>["db"];
  sqlite: ReturnType<typeof openDatabase>["sqlite"];
  clock: ReturnType<typeof createClock>;
  root: string;
  objects: ObjectStore;
  noticeCrypto: ReturnType<typeof createDeletionNoticeCrypto>;
}

async function freshAccount() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      createdAt: now,
      email: "maya@example.com",
      emailVerified: true,
      id: USER_ID,
      name: "Maya Okafor",
      role: "user",
      updatedAt: now,
    })
    .run();

  db.insert(browserProfiles)
    .values({
      countryCode: "ca",
      createdAt: now,
      lastUsedAt: now,
      provider: "browser_use",
      providerProfileId: PROFILE_ID,
      userId: USER_ID,
    })
    .run();

  db.insert(mailboxes)
    .values({
      createdAt: now,
      id: "mailbox-1",
      localPart: MAILBOX_LOCAL_PART,
      status: "active",
      userId: USER_ID,
    })
    .run();

  const root = await mkdtemp(join(tmpdir(), "overture-erase-"));

  const objects = createDiskObjectStore(root);

  await Promise.all(
    OBJECT_KEYS.map(async (key) => {
      await objects.put(key, new Uint8Array([1]));
    }),
  );

  const fixture: AccountFixture = {
    clock,
    db,
    noticeCrypto: createDeletionNoticeCrypto(masterKeyringFor(new Uint8Array(32).fill(7))),
    objects,
    root,
    sqlite,
  };

  return fixture;
}

async function cleanup(account: AccountFixture) {
  await Promise.all(
    OBJECT_PREFIXES.map(async (prefix) => {
      await chmod(join(account.root, prefix, USER_ID), 0o700).catch(() => undefined);
    }),
  );

  account.sqlite.close();
  await rm(account.root, { force: true, recursive: true });
}

function eraserFor(
  account: AccountFixture,
  deps: { objects?: ObjectStore; providers: BrowserProviderRegistry },
) {
  return createAccountEraser({
    clock: account.clock,
    db: account.db,
    mailboxes: createMailboxService(
      account.db,
      account.clock,
      "hmac-secret",
      "tryoverture.example",
    ),
    objects: deps.objects ?? account.objects,
    personal: createPersonalCrypto(account.db, masterKeyringFor(new Uint8Array(32).fill(7))),
    providers: deps.providers,
    sealNotice: async (notice) => {
      await Promise.resolve();

      return account.noticeCrypto.seal(notice);
    },
  });
}

async function blockObjectDeletes(account: AccountFixture) {
  await Promise.all(
    OBJECT_PREFIXES.map(async (prefix) => {
      await chmod(join(account.root, prefix, USER_ID), 0o500);
    }),
  );
}

async function allowObjectDeletes(account: AccountFixture) {
  await Promise.all(
    OBJECT_PREFIXES.map(async (prefix) => {
      await chmod(join(account.root, prefix, USER_ID), 0o700);
    }),
  );
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return null;
}

function userRows(account: AccountFixture) {
  return account.db.select().from(users).where(eq(users.id, USER_ID)).all();
}

function profileRows(account: AccountFixture) {
  return account.db.select().from(browserProfiles).where(eq(browserProfiles.userId, USER_ID)).all();
}

function erasure(account: AccountFixture) {
  return account.db.select().from(accountErasures).where(eq(accountErasures.userId, USER_ID)).get();
}

function vendorProfilesOf(account: AccountFixture) {
  return storedVendorProfilesSchema.parse(JSON.parse(erasure(account)?.vendorProfiles ?? "[]"));
}

function jobs(account: AccountFixture) {
  return account.db.select().from(bgJobs).all();
}

function eraseJobs(account: AccountFixture) {
  return jobs(account).filter((job) => job.kind === ACCOUNT_ERASE_JOB_KIND);
}

function noticeJobs(account: AccountFixture) {
  return jobs(account).filter((job) => job.kind === ACCOUNT_DELETED_NOTICE_JOB_KIND);
}

async function openedNotice(account: AccountFixture) {
  const [job] = noticeJobs(account);

  if (job === undefined) {
    return null;
  }

  return account.noticeCrypto.open(job.payload);
}

async function noticeHandler() {
  await Promise.resolve();
}

describe("account erasure across external cleanup failures", () => {
  test("a transient vendor delete failure retries after a restart before the confirmation", async () => {
    const account = await freshAccount();
    const failing = profileFixture({ failures: 1 });

    try {
      const first = eraserFor(account, { providers: providersFor(account, failing) });

      const firstError = await rejectionOf(first.run(payload));

      expect(firstError).toBeInstanceOf(RetryLaterError);
      expect(failing.deleted).toEqual([]);
      expect(noticeJobs(account)).toHaveLength(0);
      expect(userRows(account)).toHaveLength(0);
      expect(profileRows(account)).toHaveLength(0);
      expect(vendorProfilesOf(account)).toEqual([
        { provider: "browser_use", providerProfileId: PROFILE_ID },
      ]);
      expect(erasure(account)).toMatchObject({
        noticeName: "Maya Okafor",
        noticeQueuedAt: null,
        noticeTo: "maya@example.com",
        vendorCleanedAt: null,
      });

      const restartedFixture = profileFixture();

      try {
        const restarted = eraserFor(account, {
          providers: providersFor(account, restartedFixture),
        });

        await restarted.run(payload);

        expect(restartedFixture.deleted).toEqual([PROFILE_ID]);
        expect(await openedNotice(account)).toEqual({
          name: "Maya Okafor",
          to: "maya@example.com",
        });
        expect(erasure(account)).toMatchObject({
          noticeName: null,
          noticeTo: null,
          vendorProfiles: "[]",
        });
        expect(erasure(account)?.noticeQueuedAt).not.toBeNull();
        expect(erasure(account)?.vendorCleanedAt).not.toBeNull();
        expect(erasure(account)?.objectsCleanedAt).not.toBeNull();

        await restarted.run(payload);

        expect(noticeJobs(account)).toHaveLength(1);

        account.db
          .update(bgJobs)
          .set({ status: "done" })
          .where(eq(bgJobs.id, noticeJobs(account)[0]?.id ?? ""))
          .run();

        await restarted.run(payload);

        expect(noticeJobs(account)).toHaveLength(1);
      } finally {
        restartedFixture.close();
      }
    } finally {
      failing.close();
      await cleanup(account);
    }
  });

  test("a transient R2 delete failure retries after a restart before the confirmation", async () => {
    const account = await freshAccount();
    const fixture = profileFixture();

    try {
      await blockObjectDeletes(account);

      const first = eraserFor(account, { providers: providersFor(account, fixture) });
      const firstError = await rejectionOf(first.run(payload));

      expect(firstError).toBeInstanceOf(RetryLaterError);
      expect(noticeJobs(account)).toHaveLength(0);
      expect(erasure(account)?.vendorCleanedAt).not.toBeNull();
      expect(erasure(account)?.objectsCleanedAt).toBeNull();
      expect(erasure(account)?.lastError).toContain("EACCES");

      await allowObjectDeletes(account);

      const restarted = eraserFor(account, { providers: providersFor(account, fixture) });

      await restarted.run(payload);

      const leftovers = await Promise.all(
        OBJECT_KEYS.map(async (key) => {
          const object = await account.objects.get(key);

          return object;
        }),
      );

      expect(leftovers).toEqual([null, null, null]);

      expect(erasure(account)?.objectsCleanedAt).not.toBeNull();
      expect(erasure(account)?.lastError).toBeNull();
      expect(await openedNotice(account)).toEqual({
        name: "Maya Okafor",
        to: "maya@example.com",
      });
    } finally {
      fixture.close();
      await cleanup(account);
    }
  });

  test("the confirmation waits for both external deletions after the user row is gone", async () => {
    const account = await freshAccount();
    const failing = profileFixture({ failures: 1 });

    try {
      await blockObjectDeletes(account);

      const first = eraserFor(account, { providers: providersFor(account, failing) });
      const firstError = await rejectionOf(first.run(payload));

      expect(firstError).toBeInstanceOf(RetryLaterError);
      expect(userRows(account)).toHaveLength(0);
      expect(noticeJobs(account)).toHaveLength(0);
      expect(failing.deleted).toEqual([]);
      expect(vendorProfilesOf(account)).toHaveLength(1);
      expect(await account.objects.get(OBJECT_KEYS[0] ?? "")).not.toBeNull();

      await allowObjectDeletes(account);

      const restartedFixture = profileFixture();

      try {
        const restarted = eraserFor(account, {
          providers: providersFor(account, restartedFixture),
        });

        await restarted.run(payload);

        expect(restartedFixture.deleted).toEqual([PROFILE_ID]);
        expect(await account.objects.get(OBJECT_KEYS[0] ?? "")).toBeNull();
        expect(noticeJobs(account)).toHaveLength(1);
      } finally {
        restartedFixture.close();
      }
    } finally {
      failing.close();
      await cleanup(account);
    }
  });

  test("the queued erase job retries without consuming an attempt, then finishes", async () => {
    const account = await freshAccount();
    const firstFixture = profileFixture({ failures: 1 });

    try {
      const eraser = eraserFor(account, { providers: providersFor(account, firstFixture) });

      const handlers = {
        [ACCOUNT_ERASE_JOB_KIND]: async (raw: string) => eraser.run(raw),
        [ACCOUNT_DELETED_NOTICE_JOB_KIND]: noticeHandler,
      };

      enqueueJob(account.db, account.clock, ACCOUNT_ERASE_JOB_KIND, payload, { maxAttempts: 5 });

      expect(await runDueJobs(account.db, account.clock, handlers)).toBe(0);

      const [queued] = eraseJobs(account);

      expect(queued).toMatchObject({ attempts: 0, status: "queued" });
      expect(queued?.lastError).toContain("deleteProfile");
      expect(noticeJobs(account)).toHaveLength(0);

      account.clock.setOffset(ERASURE_RETRY_DELAY_MS + 1000);

      const restartedFixture = profileFixture();

      try {
        const restarted = eraserFor(account, {
          providers: providersFor(account, restartedFixture),
        });

        expect(
          await runDueJobs(account.db, account.clock, {
            [ACCOUNT_ERASE_JOB_KIND]: async (raw: string) => restarted.run(raw),
            [ACCOUNT_DELETED_NOTICE_JOB_KIND]: noticeHandler,
          }),
        ).toBe(1);
        expect(eraseJobs(account)[0]?.status).toBe("done");
        expect(noticeJobs(account)).toHaveLength(1);
        expect(noticeJobs(account)[0]?.status).toBe("queued");

        expect(await runDueJobs(account.db, account.clock, handlers)).toBe(1);
        expect(noticeJobs(account)[0]?.status).toBe("done");
      } finally {
        restartedFixture.close();
      }
    } finally {
      firstFixture.close();
      await cleanup(account);
    }
  });

  test("two concurrent runs queue at most one confirmation", async () => {
    const account = await freshAccount();
    const fixture = profileFixture();

    try {
      const eraser = eraserFor(account, { providers: providersFor(account, fixture) });

      await Promise.all([eraser.run(payload), eraser.run(payload)]);

      expect(noticeJobs(account)).toHaveLength(1);
      expect(erasure(account)?.noticeQueuedAt).not.toBeNull();
    } finally {
      fixture.close();
      await cleanup(account);
    }
  });

  test("a profile the vendor already reports as gone counts as clean", async () => {
    const account = await freshAccount();
    const gone = profileFixture({ failures: 1, status: 404 });

    try {
      const eraser = eraserFor(account, { providers: providersFor(account, gone) });

      await eraser.run(payload);

      expect(await openedNotice(account)).toEqual({
        name: "Maya Okafor",
        to: "maya@example.com",
      });
      expect(erasure(account)?.vendorCleanedAt).not.toBeNull();
    } finally {
      gone.close();
      await cleanup(account);
    }
  });

  test("retiring the mailbox is part of the same durable step", async () => {
    const account = await freshAccount();
    const fixture = profileFixture();

    try {
      const eraser = eraserFor(account, { providers: providersFor(account, fixture) });

      await eraser.run(payload);

      expect(account.db.select().from(mailboxes).all()).toEqual([]);
      expect(
        account.db.select({ localPart: retiredAddresses.localPart }).from(retiredAddresses).all(),
      ).toEqual([{ localPart: MAILBOX_LOCAL_PART }]);
      expect(
        account.db.select().from(accountErasures).where(eq(accountErasures.userId, USER_ID)).get()
          ?.userDeletedAt,
      ).not.toBeNull();
    } finally {
      fixture.close();
      await cleanup(account);
    }
  });
});
