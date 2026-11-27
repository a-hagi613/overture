import { describe, expect, test } from "bun:test";

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import { applications, jobs, mailboxes, profiles, resumes, users } from "../platform/db/schema.ts";
import { createFactService } from "../profile/facts.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { createQuestionCatalog } from "../catalog/questions.ts";
import { openReviewsForApplication } from "./review-store.ts";

Bun.env.BETTER_AUTH_SECRET ??= "freehire-prepare-test-secret";
Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(8)).toString("base64");
Bun.env.OWNER_EMAIL ??= "owner@example.test";
Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";
Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { createPreparationService } = await import("./prepare.ts");

const NOW = Date.UTC(2026, 10, 27, 8, 0);
const JOB_ID = "freehire-job-1";

function fakeLlm() {
  const empty = {
    cachedTokens: 0,
    cacheWriteTokens: 0,
    costMicros: 0,
    inputTokens: 0,
    model: "fake",
    outputTokens: 0,
    text: null,
  };

  return {
    estimateBatchCostMicros: () => 0,
    estimateSingleCostMicros: () => 0,
    estimateStructuredCostMicros: () => 0,
    runBatch: async () => {
      await Promise.resolve();

      return [];
    },
    runSingle: async () => {
      await Promise.resolve();

      return empty;
    },
    runStructured: async () => {
      await Promise.resolve();

      return empty;
    },
  };
}

function questionEntries(
  catalog: ReturnType<typeof createQuestionCatalog>,
  inputs: readonly {
    fieldName: string;
    fieldType: "text" | "email" | "phone" | "file" | "select";
    label: string;
    options?: string[];
    required: boolean;
  }[],
) {
  return inputs.map((question, position) => {
    const record = catalog.findOrCreate({
      companyNames: ["Acme"],
      fieldName: question.fieldName,
      fieldType: question.fieldType,
      options: question.options ?? [],
      text: question.label,
    });

    return {
      fieldName: question.fieldName,
      options: question.options ?? [],
      position,
      questionId: record.id,
      required: question.required,
    };
  });
}

const QUESTIONS = [
  { fieldName: "first_name", fieldType: "text", label: "First Name", required: true },
  { fieldName: "email", fieldType: "email", label: "Email", required: true },
  { fieldName: "phone", fieldType: "phone", label: "Phone", required: true },
  { fieldName: "resume", fieldType: "file", label: "Resume/CV", required: true },
  {
    fieldName: "question_1",
    fieldType: "select",
    label: "Have you ever worked for Acme (as an employee, intern, or contractor)?",
    options: ["No, never", "Yes, currently", "Yes, in the past"],
    required: true,
  },
] as const;

async function seeded(dir: string) {
  const path = join(dir, "app.sqlite");
  const app = openDatabase(path);

  migrateDatabase(app.db, "drizzle");

  const { db: catalogDb } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(catalogDb, "drizzle-catalog");

  const clock = createClock();
  const personal = createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(9)));

  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "maya@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Maya Chen",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  app.db
    .insert(profiles)
    .values({
      createdAt: new Date(NOW),
      timezone: "UTC",
      updatedAt: new Date(NOW),
      userId: "user-1",
    })
    .run();

  app.db
    .insert(mailboxes)
    .values({
      applyAddress: "maya.4k@tryoverture.com",
      createdAt: new Date(NOW),
      id: "mailbox-1",
      localPart: "maya.4k",
      userId: "user-1",
    })
    .run();

  const resumeText = "Maya Chen · Senior Software Engineer · Ottawa, ON, Canada";

  app.db
    .insert(resumes)
    .values({
      bytes: 1024,
      filenameEnc: await personal.sealFor(
        "user-1",
        { column: "filename_enc", rowId: "resume-1", table: "resumes" },
        "maya-chen.pdf",
      ),
      id: "resume-1",
      isCurrent: true,
      objectKey: "resumes/maya-chen.pdf",
      pages: 1,
      parsedWith: "unpdf",
      sha256: "0".repeat(64),
      textEnc: await personal.sealFor(
        "user-1",
        { column: "text_enc", rowId: "resume-1", table: "resumes" },
        resumeText,
      ),
      uploadedAt: new Date(NOW),
      userId: "user-1",
    })
    .run();

  app.db
    .insert(jobs)
    .values({
      applyUrl: "https://boards.greenhouse.io/acme/jobs/123",
      applyVia: "direct",
      atsJobId: "123",
      boardToken: "acme",
      cities: '["Ottawa"]',
      company: "Acme",
      companyNorm: "acme",
      countries: '["ca"]',
      createdAt: NOW,
      dedupeKey: JOB_ID,
      description: "Build backend services in Go.",
      externalId: "acme:123",
      firstSeenAt: NOW,
      freehireSource: "greenhouse",
      id: JOB_ID,
      language: "en",
      lastSeenAt: NOW,
      locationRaw: "Ottawa, ON, Canada",
      postedAt: NOW,
      source: "greenhouse",
      status: "open",
      title: "Senior Software Engineer",
      titleNorm: "senior software engineer",
      updatedAt: NOW,
      url: "https://boards.greenhouse.io/acme/jobs/123",
      workMode: "remote",
    })
    .run();

  app.db
    .insert(applications)
    .values({
      applyUrl: "https://boards.greenhouse.io/acme/jobs/123",
      ats: "greenhouse",
      companyId: "acme",
      companyName: "Acme",
      companyNameNorm: "acme",
      createdAt: NOW,
      id: "application-1",
      origin: "pick",
      postingId: JOB_ID,
      postingTitle: "Senior Software Engineer",
      postingUrl: "https://boards.greenhouse.io/acme/jobs/123",
      status: "preparing",
      updatedAt: NOW,
      userId: "user-1",
    })
    .run();

  const facts = createFactService({ clock, db: app.db, personal });

  for (const [key, value] of [
    ["legal_name", "Maya Chen"],
    ["email", "maya@example.test"],
    ["phone", "613-555-0142"],
    ["current_city", "Ottawa"],
    ["current_country", "Canada"],
    ["work_auth", "Canadian citizen"],
    ["sponsorship_required", "No"],
    ["notice_period", "30 days"],
  ] as const) {
    await facts.save("user-1", key, value, "");
  }

  const questionCatalog = createQuestionCatalog({ catalogDb, clock, db: app.db });

  questionCatalog.saveJobQuestions(JOB_ID, questionEntries(questionCatalog, QUESTIONS));

  const preparation = createPreparationService({
    catalogDb,
    clock,
    db: app.db,
    llm: fakeLlm(),
    personal,
    source: null,
  });

  return { app, preparation };
}

describe("a freehire application prepares without the legacy catalog", () => {
  test("reads the job, stores its questions in this database and opens Review", async () => {
    const dir = mkdtempSync(join(tmpdir(), "overture-freehire-prepare-"));

    try {
      const { app, preparation } = await seeded(dir);
      const result = await preparation.prepare("application-1");

      expect(result).not.toBeNull();

      const reviews = openReviewsForApplication(app.db, "user-1", "application-1");

      expect(reviews.map((review) => review.prompt)).toContain(
        "Have you ever worked for Acme (as an employee, intern, or contractor)?",
      );

      const plan = await preparation.sendPlanFor("application-1");

      expect(plan?.ats).toBe("greenhouse");
      expect(plan?.boardToken).toBe("acme");
      expect(plan?.atsJobId).toBe("123");
      expect(plan?.postingUrl).toContain("for=acme");
      expect(plan?.postingUrl).toContain("token=123");
      expect(plan?.companyName).toBe("Acme");

      const planAgain = await preparation.sendPlanFor("application-1");

      expect(planAgain?.fields.map((field) => field.label)).toEqual(
        plan?.fields.map((field) => field.label),
      );

      app.sqlite.close();

      // A fresh handle reads the stored question list rather than re-fetching the employer's form.
      const reopened = openDatabase(join(dir, "app.sqlite"));
      const catalogAfter = createQuestionCatalog({
        catalogDb: openCatalogDatabase(":memory:").db,
        clock: createClock(),
        db: reopened.db,
      });

      expect(catalogAfter.forJob(JOB_ID).map((row) => row.textDisplay)).toHaveLength(
        QUESTIONS.length,
      );
      expect(reopened.db.select().from(applications).all()).toHaveLength(1);
      reopened.sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
