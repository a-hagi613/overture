import { describe, expect, test } from "bun:test";

import type { ObjectStore } from "../platform/ports/object-store.ts";

import { masterKeyringFor } from "../platform/crypto.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import {
  applications,
  attempts,
  bgJobs,
  grants,
  ledger,
  mailboxes,
  mailThreads,
  messages,
  users,
} from "../platform/db/schema.ts";
import { recordApplicationEvent } from "../applications/events.ts";
import { applicationScreenshotKey } from "../applications/screenshots.ts";
import { lookupApplication } from "./application-lookup.ts";

Bun.env.BETTER_AUTH_SECRET ??= "application-lookup-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "application-lookup-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "application-lookup-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);
const USER_ID = "user-lookup";
const APPLICATION_ID = "application-lookup";

const MASTER = new Uint8Array(32).fill(9);
const clock = { now: () => NOW };

function memoryStore() {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();

  const store: ObjectStore = {
    kind: "disk",
    delete: async (key) => {
      await Promise.resolve();
      files.delete(key);
    },
    get: async (key) => {
      await Promise.resolve();

      return files.get(key) ?? null;
    },
    getStream: async () => {
      await Promise.resolve();

      return null;
    },
    list: async function* list(prefix) {
      await Promise.resolve();

      for (const key of [...files.keys()].toSorted()) {
        if (key.startsWith(prefix)) {
          yield key;
        }
      }
    },
    listWithSizes: async function* listWithSizes(prefix) {
      await Promise.resolve();

      for (const key of [...files.keys()].toSorted()) {
        if (key.startsWith(prefix)) {
          yield { bytes: files.get(key)?.byteLength ?? 0, key };
        }
      }
    },
    put: async (key, data) => {
      await Promise.resolve();
      files.set(key, data);
    },
    putStream: async () => {
      await Promise.resolve();

      return 0;
    },
  };

  return { files, store };
}

async function seeded() {
  const { db } = openCountingDatabase();
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const { files, store } = memoryStore();

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "lookup@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Lookup Person",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  db.insert(applications)
    .values({
      ats: "greenhouse",
      browserCostMicros: 12_000,
      companyId: "company-lookup",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      createdAt: NOW,
      costRecordedAt: NOW,
      id: APPLICATION_ID,
      llmCostMicros: 3000,
      origin: "pick",
      postingId: "posting-lookup",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "https://boards.example/jobs/lookup",
      retryCostMicros: 1000,
      sentAt: NOW + 1000,
      stage: "applied",
      status: "confirming",
      updatedAt: NOW,
      userId: USER_ID,
    })
    .run();

  db.insert(attempts)
    .values({
      applicationId: APPLICATION_ID,
      browserMs: 30_000,
      captchaSeen: false,
      codeUsed: false,
      costMicros: 12_000,
      endedAt: NOW + 1000,
      id: "attempt-lookup",
      leaseUntil: NOW + 60_000,
      n: 1,
      outcome: "unconfirmed",
      provider: "browser_use",
      providerSessionId: "session-1",
      proxyBytes: null,
      startedAt: NOW,
      submitClickedAt: NOW + 500,
      submitResponseStatus: 200,
      userId: USER_ID,
    })
    .run();

  recordApplicationEvent(db, clock, {
    applicationId: APPLICATION_ID,
    attemptId: "attempt-lookup",
    fromValue: "sending",
    kind: "status",
    reason: "deploy_interruption",
    source: "system",
    toValue: "confirming",
    userId: USER_ID,
  });

  db.insert(bgJobs)
    .values({
      attempts: 1,
      createdAt: NOW,
      id: "job-lookup",
      kind: "application.send",
      lastError: null,
      maxAttempts: 3,
      payload: JSON.stringify({ applicationId: APPLICATION_ID }),
      priority: 0,
      runAt: NOW,
      status: "done",
      updatedAt: NOW,
    })
    .run();

  db.insert(grants)
    .values({
      createdAt: NOW,
      expiresAt: null,
      id: "grant-lookup",
      quantity: 1,
      source: "trial",
      startsAt: NOW,
      userId: USER_ID,
    })
    .run();

  db.insert(ledger)
    .values({
      amount: 1,
      applicationId: APPLICATION_ID,
      createdAt: NOW,
      creditAccount: "used",
      debitAccount: "reserved",
      grantId: "grant-lookup",
      id: "ledger-lookup",
      idempotencyKey: `commit:${APPLICATION_ID}`,
      kind: "commit",
      userId: USER_ID,
    })
    .run();

  db.insert(mailboxes)
    .values({
      createdAt: new Date(NOW),
      id: "mailbox-lookup",
      localPart: "lookup-mailbox",
      status: "active",
      userId: USER_ID,
    })
    .run();

  db.insert(mailThreads)
    .values({
      applicationId: APPLICATION_ID,
      employerStarted: true,
      id: "thread-lookup",
      lastMessageAt: new Date(NOW + 2000),
      subjectEnc: await personal.sealFor(
        USER_ID,
        { column: "subject_enc", rowId: "thread-lookup", table: "mail_threads" },
        "Thanks for applying",
      ),
      userId: USER_ID,
    })
    .run();

  db.insert(messages)
    .values({
      auth: "pass",
      classification: "ack",
      createdAt: new Date(NOW + 2000),
      direction: "in",
      fromEnc: await personal.sealFor(
        USER_ID,
        { column: "from_enc", rowId: "message-lookup", table: "messages" },
        "jobs@ferro.example",
      ),
      htmlObjectKey: null,
      id: "message-lookup",
      inReplyTo: null,
      mailboxId: "mailbox-lookup",
      providerMessageId: null,
      rfcMessageId: "rfc-lookup",
      senderDomain: "ferro.example",
      snippetEnc: await personal.sealFor(
        USER_ID,
        { column: "snippet_enc", rowId: "message-lookup", table: "messages" },
        "We got it",
      ),
      subjectEnc: await personal.sealFor(
        USER_ID,
        { column: "subject_enc", rowId: "message-lookup", table: "messages" },
        "Application received",
      ),
      textEnc: await personal.sealFor(
        USER_ID,
        { column: "text_enc", rowId: "message-lookup", table: "messages" },
        "We received your application.",
      ),
      threadId: "thread-lookup",
      toEnc: await personal.sealFor(
        USER_ID,
        { column: "to_enc", rowId: "message-lookup", table: "messages" },
        "lookup@example.test",
      ),
      userId: USER_ID,
    })
    .run();

  files.set(
    applicationScreenshotKey({
      applicationId: APPLICATION_ID,
      at: NOW + 500,
      attemptId: "attempt-lookup",
      phase: "before_submit",
      userId: USER_ID,
    }),
    new Uint8Array([1, 2, 3]),
  );
  files.set(
    applicationScreenshotKey({
      applicationId: APPLICATION_ID,
      at: NOW + 600,
      attemptId: "attempt-lookup",
      phase: "after_submit",
      userId: USER_ID,
    }),
    new Uint8Array([4, 5, 6]),
  );

  return { db, personal, store };
}

describe("the application support lookup", () => {
  test("returns null for an unknown application", async () => {
    const { db, personal, store } = await seeded();

    expect(await lookupApplication({ clock, db, objects: store, personal }, "missing")).toBeNull();
  });

  test("traces timeline, queue, attempts, confirmation, balance, mail and screenshots", async () => {
    const { db, personal, store } = await seeded();

    const view = await lookupApplication({ clock, db, objects: store, personal }, APPLICATION_ID);

    if (view === null) {
      throw new Error("the lookup returned null");
    }

    expect(view.application).toMatchObject({
      companyName: "Ferro Cloud",
      id: APPLICATION_ID,
      stage: "applied",
      status: "confirming",
      userId: USER_ID,
    });
    expect(view.timeline[0]).toMatchObject({
      attemptId: "attempt-lookup",
      reason: "deploy_interruption",
      toValue: "confirming",
    });
    expect(view.queue.jobs.map((job) => job.kind)).toEqual(["application.send"]);
    expect(view.attempts[0]).toMatchObject({
      id: "attempt-lookup",
      outcome: "unconfirmed",
      submitClickedAt: NOW + 500,
    });
    expect(view.confirmation).toEqual({ receipt: null, snapshot: null });
    expect(view.balance.ledger[0]).toMatchObject({ amount: 1, kind: "commit" });
    expect(view.balance.balances.used).toBe(1);
    expect(view.mail[0]?.subject).toBe("Thanks for applying");
    expect(view.mail[0]?.messages[0]).toMatchObject({
      classification: "ack",
      direction: "in",
      subject: "Application received",
    });
    expect(view.screenshots.map((shot) => shot.phase)).toEqual(["before_submit", "after_submit"]);
  });

  test("an unreadable mail subject stays null instead of failing the lookup", async () => {
    const { db, personal, store } = await seeded();

    db.run("update messages set subject_enc = 'not-a-sealed-value'");

    const view = await lookupApplication({ clock, db, objects: store, personal }, APPLICATION_ID);

    if (view === null) {
      throw new Error("the lookup returned null");
    }

    expect(view.mail[0]?.messages[0]?.subject).toBeNull();
  });
});
