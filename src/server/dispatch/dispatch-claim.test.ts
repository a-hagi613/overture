import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { migrateDatabase, migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { sealApprovedPlan } from "../pipeline/approved-plan.ts";
import { setSetting } from "../platform/settings/index.ts";
import { grantApplications } from "../billing/ledger.ts";
import { applications, mailboxes, profiles, resumes, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";

import type { Clock } from "../platform/ports/clock.ts";
import type { PostingLiveness } from "./liveness.ts";
import type { SendPlan } from "../pipeline/send-plan.ts";
import type { ApplySupportedAts } from "../../shared/ats.ts";

Bun.env.BETTER_AUTH_SECRET ??= "dispatch-claim-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "dispatch-claim-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "dispatch-claim-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { createDispatcherTick } = await import("./dispatch.ts");
const { createPostingLiveness } = await import("./liveness.ts");

const AT = Date.UTC(2026, 10, 27, 12);

const clock: Clock = { now: () => AT };

interface SeededPosting {
  applicationId: string;
  ats: string;
  postingId: string;
}

async function seedApplication(input: {
  ats: ApplySupportedAts;
  id: string;
  jobId: string;
  liveness: PostingLiveness;
}) {
  const db = openDatabase(":memory:");
  migrateDatabase(db.db, "drizzle");

  const catalog = openCatalogDatabase(":memory:");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  const personal = createPersonalCrypto(db.db, masterKeyringFor(new Uint8Array(32).fill(7)));

  const userId = `user-${input.id}`;

  db.db
    .insert(users)
    .values({
      createdAt: new Date(AT),
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "Maya Okafor",
      role: "user",
      updatedAt: new Date(AT),
    })
    .run();

  db.db
    .insert(profiles)
    .values({
      createdAt: new Date(AT),
      running: true,
      timezone: "UTC",
      updatedAt: new Date(AT),
      userId,
    })
    .run();

  db.db
    .insert(resumes)
    .values({
      bytes: 10,
      filenameEnc: "sealed",
      id: `resume-${userId}`,
      isCurrent: true,
      objectKey: `resumes/${userId}.pdf`,
      pages: 1,
      parsedWith: "unpdf",
      sha256: "a".repeat(64),
      textEnc: "sealed",
      uploadedAt: new Date(AT),
      userId,
    })
    .run();

  db.db
    .insert(mailboxes)
    .values({
      applyAddress: `apply-${userId}@tryoverture.test`,
      createdAt: new Date(AT),
      id: `mailbox-${userId}`,
      localPart: `apply-${userId}`,
      status: "active",
      userId,
    })
    .run();

  grantApplications(db.db, clock, {
    idempotencyKey: `grant-${userId}`,
    quantity: 5,
    source: "admin",
    startsAt: 0,
    userId,
  });

  catalog.db
    .insert(companies)
    .values({
      createdAt: AT,
      id: `company-${input.id}`,
      name: "Example Co",
      nameNorm: "example co",
    })
    .run();

  catalog.db
    .insert(companyBoards)
    .values({
      ats: input.ats,
      boardToken: `board-${input.id}`,
      companyId: `company-${input.id}`,
      createdAt: AT,
      id: `board-${input.id}`,
      source: "v1_seed",
    })
    .run();

  const postingId = `posting-${input.id}`;

  catalog.db
    .insert(postings)
    .values({
      applyUrlNorm: `https://example.test/${input.id}`,
      ats: input.ats,
      atsJobId: input.jobId,
      boardId: `board-${input.id}`,
      companyId: `company-${input.id}`,
      dedupeKey: `dedupe-${input.id}`,
      firstSeenAt: AT,
      id: postingId,
      lastSeenAt: AT,
      title: "Platform Engineer",
      titleNorm: "platform engineer",
      url: `https://example.test/${input.id}`,
    })
    .run();

  const plan: SendPlan = {
    applicationId: input.id,
    ats: input.ats,
    atsJobId: input.jobId,
    boardToken: `board-${input.id}`,
    companyName: "Example Co",
    consentVersion: "1",
    coverLetter: null,
    descriptionHash: null,
    fields: [],
    postingTitle: "Platform Engineer",
    postingUrl: `https://example.test/${input.id}`,
    resume: null,
    userId,
  };

  const sealed = await sealApprovedPlan({ applicationId: input.id, personal, plan });

  db.db
    .insert(applications)
    .values({
      approvedAt: AT,
      approvedPlanEnc: sealed.enc,
      approvedPlanSha256: sealed.sha256,
      ats: input.ats,
      companyId: `company-${input.id}`,
      companyName: "Example Co",
      companyNameNorm: "example co",
      createdAt: AT,
      id: input.id,
      origin: "pick",
      postingId,
      postingTitle: "Platform Engineer",
      postingUrl: `https://example.test/${input.id}`,
      scheduledFor: AT - 60_000,
      status: "approved",
      updatedAt: AT,
      userId,
    })
    .run();

  setSetting(
    db.db,
    clock,
    "limits.send_window",
    JSON.stringify({ end: "24:00", start: "00:00" }),
    "system:test",
  );

  const enqueued: string[] = [];

  const tick = createDispatcherTick({
    catalogDb: catalog.db,
    clock,
    db: db.db,
    enqueueSend: (applicationId) => {
      enqueued.push(applicationId);

      return `job-${applicationId}`;
    },
    liveness: {
      check: async () => {
        await Promise.resolve();

        return input.liveness;
      },
    },
    personal,
    providerId: "local",
  });

  return {
    app: db,
    catalog,
    enqueued,
    posting: { applicationId: input.id, ats: input.ats, postingId } satisfies SeededPosting,
    tick,
    userId,
  };
}

describe("dispatch claims an approved application whose liveness is unknown", () => {
  test("an approved JazzHR application with a due scheduled_for is claimed", async () => {
    const seeded = await seedApplication({
      ats: "jazzhr",
      id: "app-jazzhr",
      jobId: "JZZ-1001",
      liveness: "unknown",
    });

    try {
      const summary = await seeded.tick.run();

      expect(summary.claimed).toBe(1);
      expect(seeded.enqueued).toEqual(["app-jazzhr"]);
    } finally {
      seeded.app.sqlite.close();
      seeded.catalog.sqlite.close();
    }
  });

  test("a posting the liveness source says is closed is skipped, not sent", async () => {
    const seeded = await seedApplication({
      ats: "greenhouse",
      id: "app-closed",
      jobId: "7006005001",
      liveness: "closed",
    });

    try {
      const summary = await seeded.tick.run();

      expect(summary.claimed).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(seeded.enqueued).toEqual([]);

      const application = seeded.app.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, "app-closed"))
        .get();

      expect(application?.status).toBe("skipped");

      const posting = seeded.catalog.db
        .select({ closedAt: postings.closedAt })
        .from(postings)
        .where(eq(postings.id, "posting-app-closed"))
        .get();

      expect(posting?.closedAt).toBe(AT);
    } finally {
      seeded.app.sqlite.close();
      seeded.catalog.sqlite.close();
    }
  });
});

describe("createPostingLiveness only asks a source it has", () => {
  test("a board with no liveness source is unknown, never a false closed from Ashby", async () => {
    const server = Bun.serve({
      fetch: () => new Response(null, { status: 404 }),
      port: 0,
    });

    const base = server.url.toString().replace(/\/$/u, "");

    try {
      const check = createPostingLiveness({
        ASHBY_FEED_BASE_URL: base,
        GREENHOUSE_FEED_BASE_URL: base,
        LEVER_EU_FEED_BASE_URL: base,
        LEVER_FEED_BASE_URL: base,
      });

      const target = { atsJobId: "1", boardToken: "board", region: "us" } as const;

      expect(await check.check({ ...target, ats: "jazzhr" })).toBe("unknown");
      expect(await check.check({ ...target, ats: "bamboohr" })).toBe("unknown");
      expect(await check.check({ ...target, ats: "personio" })).toBe("unknown");
      expect(await check.check({ ...target, ats: "greenhouse" })).toBe("closed");
    } finally {
      void server.stop(true);
    }
  });
});
