import { afterEach, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { masterKeyringFor } from "../platform/crypto.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import {
  applications,
  grants,
  jobs,
  ledger,
  mailboxes,
  profiles,
  resumes,
  users,
} from "../platform/db/schema.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LivenessTarget, PostingLiveness } from "./liveness.ts";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

const { createDispatcherTick } = await import("./dispatch.ts");

const NOW = 1_796_000_000_000;
const USER = "dispatch-user";

const openHandles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
});

function seedDueApplication() {
  const app = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  openHandles.push(app.sqlite, catalog.sqlite);
  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "dispatch@example.test",
      emailVerified: true,
      id: USER,
      name: "Dispatch",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();
  app.db
    .insert(profiles)
    .values({
      createdAt: new Date(NOW),
      languages: JSON.stringify(["en"]),
      pauseReason: null,
      running: true,
      updatedAt: new Date(NOW),
      userId: USER,
    })
    .run();
  app.db
    .insert(resumes)
    .values({
      bytes: 10,
      filenameEnc: "sealed",
      id: "resume-1",
      isCurrent: true,
      objectKey: "resumes/resume-1.pdf",
      pages: 1,
      parsedWith: "unpdf",
      sha256: "resume-sha",
      textEnc: "sealed",
      uploadedAt: new Date(NOW),
      userId: USER,
    })
    .run();
  app.db
    .insert(mailboxes)
    .values({
      applyAddress: "dispatch.user@example.test",
      createdAt: new Date(NOW),
      id: "mailbox-1",
      localPart: "dispatch.user",
      status: "active",
      userId: USER,
    })
    .run();
  app.db
    .insert(grants)
    .values({
      createdAt: NOW,
      id: "grant-trial",
      quantity: 3,
      source: "trial",
      startsAt: NOW - 1000,
      userId: USER,
    })
    .run();
  app.db
    .insert(ledger)
    .values({
      amount: 3,
      createdAt: NOW,
      creditAccount: "available",
      debitAccount: "issued",
      grantId: "grant-trial",
      id: "ledger-grant",
      idempotencyKey: "grant-trial",
      kind: "grant",
      userId: USER,
    })
    .run();
  app.db
    .insert(jobs)
    .values({
      applyUrl: "https://jobs.eu.lever.co/acme/123/apply",
      applyVia: "direct",
      atsJobId: "123",
      boardToken: "acme",
      company: "Acme",
      companyNorm: "acme",
      companySlug: "acme",
      countries: JSON.stringify(["ca"]),
      createdAt: NOW,
      dedupeKey: "acme|senior go engineer",
      description: "Build the payments platform.",
      externalId: "acme:123",
      firstSeenAt: NOW,
      freehireSource: "lever",
      id: "posting-job",
      lastSeenAt: NOW,
      source: "lever",
      title: "Senior Go Engineer",
      titleNorm: "senior go engineer",
      updatedAt: NOW,
      url: "https://jobs.lever.co/acme/123",
    })
    .run();
  app.db
    .insert(applications)
    .values({
      approvedAt: NOW - 5000,
      ats: "lever",
      companyId: "acme",
      companyName: "Acme",
      companyNameNorm: "acme",
      createdAt: NOW - 10_000,
      id: "application-1",
      origin: "manual",
      postingId: "posting-job",
      postingTitle: "Senior Go Engineer",
      postingUrl: "https://jobs.lever.co/acme/123",
      scheduledFor: NOW - 1000,
      status: "approved",
      updatedAt: NOW,
      userId: USER,
    })
    .run();

  const clock: Clock = { now: () => NOW };
  const personal = createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(3)));
  const targets: LivenessTarget[] = [];

  const tick = (liveness: PostingLiveness) =>
    createDispatcherTick({
      catalogDb: catalog.db,
      clock,
      db: app.db,
      enqueueSend: () => {
        throw new Error("no send should be enqueued without an approved plan");
      },
      liveness: {
        check: async (target) => {
          targets.push(target);

          await Promise.resolve();

          return liveness;
        },
      },
      personal,
      providerId: "browser_use",
    });

  return { app: app.db, targets, tick };
}

describe("the dispatch tick after the freehire cutover", () => {
  test("resolves the job identity from app.sqlite while catalog.sqlite is empty", async () => {
    const setup = seedDueApplication();

    const summary = await setup.tick("open").run();

    expect(setup.targets).toEqual([
      { ats: "lever", atsJobId: "123", boardToken: "acme", region: "eu" },
    ]);
    expect(summary).toEqual({ blocked: 1, claimed: 0, skipped: 0 });
  });

  test("closes the freehire row when liveness says the job is closed", async () => {
    const setup = seedDueApplication();

    const summary = await setup.tick("closed").run();

    const job = setup.app.select().from(jobs).where(eq(jobs.id, "posting-job")).get();

    const application = setup.app
      .select()
      .from(applications)
      .where(eq(applications.id, "application-1"))
      .get();

    expect(summary).toEqual({ blocked: 0, claimed: 0, skipped: 1 });
    expect(job).toMatchObject({ closedAt: NOW, status: "closed" });
    expect(application?.status).toBe("skipped");
  });
});
