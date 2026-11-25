import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import type { SendPlan } from "../pipeline/send-plan.ts";
import { demoLoginEmail, demoRole } from "../../shared/demo.ts";
import {
  applications,
  applicationEvents,
  applicationSnapshots,
  checkins,
  facts,
  interviewEvents,
  ledger,
  mailThreads,
  mailboxes,
  matches,
  messages,
  notifications,
  profiles,
  questions,
  questionVariants,
  resumes,
  reviewApplications,
  reviews,
  skipCompanies,
  targets,
  users,
} from "../platform/db/schema.ts";
import {
  companies,
  companyBoards,
  postingQuestions,
  postingTags,
  postings,
} from "../platform/db/catalog-schema.ts";
import { grantApplications, postLedgerEntry } from "../billing/ledger.ts";
import { contentHash } from "../catalog/content-hash.ts";
import { dedupeKeyFor } from "../catalog/dedupe-key.ts";
import { normalizeApplyUrl, normalizeTitle } from "../catalog/normalize.ts";
import { questionVariantHash } from "../catalog/question-normalize.ts";
import {
  addLocalDays,
  localDateAt,
  localDayStart,
  localDayStartFor,
  localTimeOn,
} from "../platform/local-time.ts";
import { sealApprovedPlan } from "../pipeline/approved-plan.ts";
import { minimalPdf } from "./pdf.ts";
import {
  DEMO_APPLICATIONS,
  DEMO_COMPANIES,
  DEMO_FACTS,
  DEMO_FORM_QUESTIONS,
  DEMO_INBOX,
  DEMO_INTERVIEWS,
  DEMO_NOTIFICATIONS,
} from "./sample-data.ts";

import type { DemoApplication } from "./sample-data.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant a demo application was sent, anchored inside the America/Toronto
 * calendar day the sample data describes. The Home charts bucket `sentAt` by
 * local day, so subtracting a fractional `sentDaysAgo` from `now` used to push
 * the only same-day row (0.08 days, about two hours) into yesterday whenever the
 * seed ran between 00:00 and 01:55 local time, leaving today's 7D bucket empty;
 * whole-day offsets could likewise slip a day across a DST change. Same-day
 * rows are clamped into `[todayStart, now]`, and older rows into their intended
 * local day, so no bucket ever loses its row and nothing lands in the future.
 * @param now The seed clock's current instant.
 * @param daysAgo Fractional days for same-day rows, whole days for older rows.
 * @returns The `sentAt` instant inside the intended local day.
 */
export function demoSentAt(now: number, daysAgo: number) {
  const candidate = now - daysAgo * DAY_MS;

  if (daysAgo < 1) {
    return Math.max(localDayStart(now, DEMO_TIMEZONE), Math.min(now, candidate));
  }

  const day = addLocalDays(localDateAt(now, DEMO_TIMEZONE), -Math.round(daysAgo));
  const dayStart = localDayStartFor(day, DEMO_TIMEZONE);
  const dayEnd = localDayStartFor(addLocalDays(day, 1), DEMO_TIMEZONE) - 1;

  return Math.max(dayStart, Math.min(dayEnd, candidate));
}

export const DEMO_USER_ID = "demo-user-0001";
const DEMO_MAILBOX_ID = "demo-mailbox-0001";
const DEMO_MAIL_LOCAL_PART = "demo-forwarding";
const DEMO_RESUME_ID = "demo-resume-0001";
const DEMO_RESUME_FILENAME = "sam-rivera-resume.pdf";
const DEMO_TIMEZONE = "America/Toronto";

/**
 * Create the demo account and its months of sample data, idempotently. Every
 * row has a stable id, so running this again completes a partial seed and
 * changes nothing else; once the seed's grant is present the call is a single
 * indexed read, so a sign-in never reseeds (#304 security review).
 * @param deps The database, clock, crypto and object store the seed writes with.
 * @returns The demo user id.
 */
export async function seedDemoAccount(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  objects: ObjectStore;
}) {
  const { db, catalogDb, clock, personal, objects } = deps;
  const now = clock.now();

  const existing = db.select().from(users).where(eq(users.email, demoLoginEmail)).get();

  if (existing !== undefined && existing.role !== demoRole) {
    throw new Error(
      `${demoLoginEmail} already belongs to a ${existing.role} account; the demo seed will not take it over.`,
    );
  }

  const userId = existing?.id ?? DEMO_USER_ID;

  const seeded = db
    .select({ id: ledger.id })
    .from(ledger)
    .where(eq(ledger.idempotencyKey, `demo-grant:${userId}`))
    .get();

  if (seeded !== undefined) {
    seedInterviews({ db, now, userId });

    return { userId };
  }

  db.insert(users)
    .values({
      createdAt: new Date(now - 120 * DAY_MS),
      email: demoLoginEmail,
      emailVerified: true,
      id: userId,
      name: "Sam Rivera",
      role: demoRole,
      updatedAt: new Date(now),
    })
    .onConflictDoNothing()
    .run();

  await seedResume({ db, now, objects, personal, userId });
  await seedFacts({ db, now, personal, userId });
  seedProfile({ db, now, userId });
  seedTargets({ db, now, userId });

  db.insert(skipCompanies)
    .values({
      companyId: null,
      createdAt: new Date(now - 120 * DAY_MS),
      domain: "bluefin-robotics.example.com",
      id: "demo-skip-01",
      name: "Bluefin Robotics",
      nameNorm: "bluefin robotics",
      reason: "current_employer",
      userId,
    })
    .onConflictDoNothing()
    .run();

  seedCatalog({ catalogDb, now });

  await seedApplications({ catalogDb, db, now, personal, userId });
  await seedInbox({ db, now, personal, userId });
  seedInterviews({ db, now, userId });
  seedNotifications({ db, now, userId });
  seedReviews({ db, now, userId });
  seedCheckins({ db, now, userId });
  seedLedger({ db, clock, userId });

  return { userId };
}

async function seedResume(input: {
  db: AppDatabase;
  now: number;
  objects: ObjectStore;
  personal: PersonalCrypto;
  userId: string;
}) {
  const { db, now, objects, personal, userId } = input;

  const text = [
    "Sam Rivera",
    "Senior Backend Engineer · Toronto, Canada",
    "",
    "Experience",
    "Bluefin Robotics — Senior Backend Engineer, 2019 to now",
    "Led the payments platform team, moving the ledgers to PostgreSQL and cutting settlement latency in half.",
    "Cedar & Co — Backend Engineer, 2016 to 2019",
    "Built the first version of the billing service and the nightly reconciliation pipeline.",
    "",
    "Skills",
    "TypeScript, Go, PostgreSQL, Kubernetes, Terraform",
    "",
    "Education",
    "BSc Computer Science, University of Waterloo, 2016",
  ].join("\n");

  const pdf = minimalPdf([
    "Sam Rivera",
    "Senior Backend Engineer",
    "Toronto, Canada",
    "sam.rivera@example.com",
  ]);

  const digest = await sha256Hex(pdf);
  const objectKey = `files/${userId}/resume/${DEMO_RESUME_ID}.pdf.enc`;

  const seal = async (column: string, value: string) =>
    personal.sealFor(userId, { column, rowId: DEMO_RESUME_ID, table: "resumes" }, value);

  await objects.put(
    objectKey,
    new TextEncoder().encode(await seal("bytes", Buffer.from(pdf).toString("base64"))),
  );

  db.insert(resumes)
    .values({
      bytes: pdf.byteLength,
      filenameEnc: await seal("filename_enc", DEMO_RESUME_FILENAME),
      id: DEMO_RESUME_ID,
      isCurrent: true,
      objectKey,
      pages: 1,
      parsedWith: "unpdf",
      sha256: digest,
      textEnc: await seal("text_enc", text),
      uploadedAt: new Date(now - 120 * DAY_MS),
      userId,
    })
    .onConflictDoNothing()
    .run();
}

async function seedFacts(input: {
  db: AppDatabase;
  now: number;
  personal: PersonalCrypto;
  userId: string;
}) {
  const { db, now, personal, userId } = input;

  const sealed = await Promise.all(
    DEMO_FACTS.map(async (fact, index) => {
      const scope = fact.scope ?? "";
      const id = `demo-fact-${String(index).padStart(2, "0")}`;

      return {
        confirmed: true,
        id,
        key: fact.key,
        revision: 1,
        scope,
        source: fact.key === "years_total" ? ("resume" as const) : ("user" as const),
        updatedAt: new Date(now - (120 - index) * DAY_MS),
        userId,
        valueEnc: await personal.sealFor(
          userId,
          { column: "value_enc", rowId: id, table: "facts" },
          fact.value,
        ),
      };
    }),
  );

  for (const row of sealed) {
    db.insert(facts).values(row).onConflictDoNothing().run();
  }
}

function seedProfile(input: { db: AppDatabase; now: number; userId: string }) {
  const { db, now, userId } = input;

  db.insert(profiles)
    .values({
      consentAt: new Date(now - 119 * DAY_MS),
      consentVersion: "m1",
      createdAt: new Date(now - 120 * DAY_MS),
      languages: JSON.stringify(["en", "fr"]),
      onboardedAt: new Date(now - 119 * DAY_MS),
      onboardingStep: 5,
      pauseReason: null,
      running: true,
      timezone: DEMO_TIMEZONE,
      updatedAt: new Date(now),
      userId,
    })
    .onConflictDoNothing()
    .run();
}

function seedTargets(input: { db: AppDatabase; now: number; userId: string }) {
  const { db, now, userId } = input;

  db.insert(targets)
    .values({
      employmentTypes: JSON.stringify(["full_time"]),
      locations: JSON.stringify(["Toronto, Ontario, Canada", "Remote — Canada"]),
      roles: JSON.stringify(["Backend Engineer", "Platform Engineer"]),
      salaryCurrency: "CAD",
      salaryFloorMinor: 14_000_000,
      salaryPeriod: "year",
      seniorities: JSON.stringify(["senior", "staff"]),
      updatedAt: new Date(now - 30 * DAY_MS),
      userId,
      version: 1,
      workplaces: JSON.stringify(["remote", "hybrid"]),
    })
    .onConflictDoNothing()
    .run();
}

function seedCatalog(input: { catalogDb: CatalogDatabase; now: number }) {
  const { catalogDb, now } = input;

  for (const [index, company] of DEMO_COMPANIES.entries()) {
    const companyId = `demo-company-${String(index).padStart(2, "0")}`;
    const boardId = `demo-board-${String(index).padStart(2, "0")}`;

    catalogDb
      .insert(companies)
      .values({
        createdAt: now - 120 * DAY_MS,
        domain: company.domain,
        id: companyId,
        industry: "Software",
        name: company.name,
        nameNorm: company.name.toLowerCase(),
      })
      .onConflictDoNothing()
      .run();

    catalogDb
      .insert(companyBoards)
      .values({
        ats: company.ats,
        boardToken: company.boardToken,
        companyId,
        createdAt: now - 120 * DAY_MS,
        id: boardId,
        lastPolledAt: now,
        nextPollAt: now + DAY_MS,
        status: "active",
        source: "discovered",
      })
      .onConflictDoNothing()
      .run();
  }
}

async function seedApplications(input: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  now: number;
  personal: PersonalCrypto;
  userId: string;
}) {
  const { db, catalogDb, now, personal, userId } = input;

  const resume = db
    .select({ id: resumes.id, sha256: resumes.sha256 })
    .from(resumes)
    .where(eq(resumes.id, DEMO_RESUME_ID))
    .get();

  if (resume === undefined) {
    throw new Error("the demo resume was not seeded");
  }

  const deferred: Promise<void>[] = [];

  for (const [index, app] of DEMO_APPLICATIONS.entries()) {
    const companyIndex = DEMO_COMPANIES.findIndex((company) => company.key === app.company);
    const company = DEMO_COMPANIES[companyIndex];

    if (company === undefined) {
      throw new Error(`unknown demo company ${app.company}`);
    }

    const companyId = `demo-company-${String(companyIndex).padStart(2, "0")}`;
    const boardId = `demo-board-${String(companyIndex).padStart(2, "0")}`;
    const postingId = `demo-posting-${String(index + 1).padStart(2, "0")}`;
    const createdAt = now - app.ageDays * DAY_MS;
    const sentAt = app.sentDaysAgo === undefined ? null : demoSentAt(now, app.sentDaysAgo);
    const url = `https://jobs.example.com/${company.boardToken}/${String(index + 1)}`;
    const titleNorm = normalizeTitle(app.title);

    catalogDb
      .insert(postings)
      .values({
        applyUrl: null,
        applyUrlNorm: normalizeApplyUrl(url),
        ats: company.ats,
        atsJobId: `demo-${String(index + 1)}`,
        boardId,
        city: "Toronto",
        closedAt: app.statusReason === "posting_closed" ? now - 2 * DAY_MS : null,
        companyId,
        countryCode: "CA",
        dedupeKey: dedupeKeyFor({
          city: "Toronto",
          companyId,
          countryCode: "CA",
          titleNorm,
        }),
        department: "Engineering",
        status: app.statusReason === "posting_closed" ? ("closed" as const) : ("open" as const),
        applySupported: true,
        descriptionGz: null,
        descriptionHash: contentHash(`${app.title} at ${company.name}`),
        employmentType: "full_time",
        firstSeenAt: now - 125 * DAY_MS,
        id: postingId,
        language: "en",
        lastSeenAt: now,
        locationRaw: "Remote — Canada",
        postedAt: createdAt - DAY_MS,
        region: "Ontario",
        salaryCurrency: "CAD",
        salaryMaxMinor: 19_000_000,
        salaryMinMinor: 15_000_000,
        salaryPeriod: "year",
        sourceUpdatedAt: now,
        title: app.title,
        titleNorm,
        url,
        workplace: index % 3 === 0 ? "hybrid" : "remote",
      })
      .onConflictDoNothing()
      .run();

    seedPostingTags({ catalogDb, companyIndex, postingId });

    if (app.questions === "form") {
      for (const [position, question] of DEMO_FORM_QUESTIONS.entries()) {
        const questionId = ensureQuestion({ db, input: question, now });

        catalogDb
          .insert(postingQuestions)
          .values({
            fieldName: null,
            options: "[]",
            position,
            postingId,
            questionId,
            required: true,
          })
          .onConflictDoNothing()
          .run();
      }
    }

    const readyAt =
      app.status === "ready" || app.status === "approved" ? now - (app.ageDays + 1) * DAY_MS : null;

    db.insert(applications)
      .values({
        applyUrl: null,
        approvedAt: app.status === "approved" ? now - 30 * 60_000 : null,
        ats: company.ats,
        boardPosition: app.stage === null ? null : index,
        changes: null,
        closedReason: app.closedReason ?? null,
        companyDomain: company.domain,
        companyId,
        companyName: company.name,
        companyNameNorm: company.name.toLowerCase(),
        createdAt,
        id: app.id,
        locationRaw: "Remote — Canada",
        origin: "auto",
        postingId,
        postingTitle: app.title,
        postingUrl: url,
        readyAt,
        salaryCurrency: "CAD",
        salaryMaxMinor: 19_000_000,
        salaryMinMinor: 15_000_000,
        salaryPeriod: "year",
        scheduledFor: app.status === "approved" ? now + DAY_MS : null,
        sentAt,
        stage: app.stage,
        stageLocked: app.stage === "closed",
        status: app.status,
        statusReason: app.statusReason ?? null,
        updatedAt: sentAt ?? createdAt,
        userId,
      })
      .onConflictDoNothing()
      .run();

    db.insert(matches)
      .values({
        codeRank: index,
        postingId,
        reason: "Strong match against your resume and targets.",
        resumeId: resume.id,
        score: app.score ?? null,
        scoredAt: now - app.ageDays * DAY_MS,
        targetsVersion: 1,
        userId,
      })
      .onConflictDoNothing()
      .run();

    if (app.status === "approved") {
      const plan: SendPlan = {
        applicationId: app.id,
        ats: company.ats,
        atsJobId: `demo-${String(index + 1)}`,
        boardToken: company.boardToken,
        companyName: company.name,
        consentVersion: "m1",
        coverLetter: null,
        descriptionHash: contentHash(`${app.title} at ${company.name}`),
        fields: [],
        postingTitle: app.title,
        postingUrl: url,
        resume: { filename: DEMO_RESUME_FILENAME, id: resume.id, sha256: resume.sha256 },
        userId,
      };

      deferred.push(
        (async () => {
          const sealed = await sealApprovedPlan({ applicationId: app.id, personal, plan });

          db.update(applications)
            .set({ approvedPlanEnc: sealed.enc, approvedPlanSha256: sealed.sha256 })
            .where(eq(applications.id, app.id))
            .run();
        })(),
      );
    }

    if (sentAt !== null) {
      deferred.push(
        seedSnapshot({ app, company: company.name, db, personal, resume, sentAt, url, userId }),
      );
    }

    seedStageEvents({ app, db, now, sentAt, userId });
  }

  await Promise.all(deferred);
}

function seedPostingTags(input: {
  catalogDb: CatalogDatabase;
  companyIndex: number;
  postingId: string;
}) {
  const { catalogDb, companyIndex, postingId } = input;

  const tags = [
    { dimension: "role" as const, value: companyIndex % 2 === 0 ? "Backend" : "Platform" },
    { dimension: "seniority" as const, value: companyIndex % 3 === 0 ? "staff" : "senior" },
  ];

  for (const tag of tags) {
    catalogDb
      .insert(postingTags)
      .values({ dimension: tag.dimension, postingId, source: "rules", value: tag.value })
      .onConflictDoNothing()
      .run();
  }
}

function ensureQuestion(input: {
  db: AppDatabase;
  input: { factKey: string | null; fieldType: "text" | "textarea"; text: string };
  now: number;
}) {
  const { db, input: question, now } = input;
  const hash = questionVariantHash(question.text);

  const existing = db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.textNormHash, hash))
    .get();

  if (existing !== undefined) {
    return existing.id;
  }

  const id = `demo-q-${hash.slice(0, 12)}`;

  db.insert(questions)
    .values({
      answerKind: question.factKey === null ? "open_text" : "fact",
      createdAt: now,
      factKey: question.factKey,
      fieldType: question.fieldType,
      id,
      mappedBy: null,
      optionsHash: null,
      seenCount: 1,
      textDisplay: question.text,
      textNormHash: hash,
    })
    .onConflictDoNothing()
    .run();

  db.insert(questionVariants)
    .values({ questionId: id, variantHash: hash })
    .onConflictDoNothing()
    .run();

  return id;
}

async function seedSnapshot(input: {
  app: DemoApplication;
  company: string;
  db: AppDatabase;
  personal: PersonalCrypto;
  resume: { id: string; sha256: string };
  sentAt: number;
  url: string;
  userId: string;
}) {
  const { app, company, db, personal, resume, sentAt, url, userId } = input;

  const answers = [
    {
      answer: "Sam Rivera",
      by_user: false,
      fact_key: "legal_name",
      fact_revision: 1,
      kind: "fact",
      label: "Full name",
      question_id: "demo-q-legal_name",
      resume_line_ids: [],
    },
    {
      answer: "9",
      by_user: false,
      fact_key: "years_total",
      fact_revision: 1,
      kind: "fact",
      label: "Years of experience",
      question_id: "demo-q-years_total",
      resume_line_ids: [],
    },
  ];

  const coverLetter = [
    {
      by_user: false,
      resume_line_ids: [],
      sentence: `Dear ${company} team, I am applying for the ${app.title} role.`,
    },
  ];

  const seal = async (column: string, value: string) =>
    personal.sealFor(userId, { column, rowId: app.id, table: "application_snapshots" }, value);

  db.insert(applicationSnapshots)
    .values({
      answersEnc: await seal("answers_enc", JSON.stringify(answers)),
      applicationId: app.id,
      approvedAt: sentAt - 60 * 60_000,
      approvedPlanSha256: null,
      confirmedBy: app.status === "confirming" ? "page" : "email",
      consentVersion: "m1",
      costMicros: 12_000,
      coverLetterEnc: await seal("cover_letter_enc", JSON.stringify(coverLetter)),
      descriptionHash: contentHash(`${app.title} at ${company}`),
      postingTitle: app.title,
      postingUrl: url,
      provider: "browser_use",
      providerSessionId: null,
      resumeId: resume.id,
      resumeSha256: resume.sha256,
      submittedAt: sentAt,
      userId,
    })
    .onConflictDoNothing()
    .run();
}

function seedStageEvents(input: {
  app: DemoApplication;
  db: AppDatabase;
  now: number;
  sentAt: number | null;
  userId: string;
}) {
  const { app, db, now, sentAt, userId } = input;

  if (app.stage === "screening" || app.stage === "interviewing" || app.stage === "offer") {
    const fromStage = app.stage === "offer" ? "interviewing" : "applied";

    db.insert(applicationEvents)
      .values({
        applicationId: app.id,
        at: now - Math.max(1, (app.sentDaysAgo ?? 30) - 3) * DAY_MS,
        detail: null,
        fromValue: fromStage,
        id: `${app.id}-event-stage`,
        kind: "stage",
        source: "email",
        toValue: app.stage,
        userId,
      })
      .onConflictDoNothing()
      .run();

    db.insert(applicationEvents)
      .values({
        applicationId: app.id,
        at: now - Math.max(1, (app.sentDaysAgo ?? 30) - 3) * DAY_MS,
        detail: null,
        fromValue: null,
        id: `${app.id}-event-email`,
        kind: "email",
        source: "email",
        toValue: "Reply received",
        userId,
      })
      .onConflictDoNothing()
      .run();
  }

  if (app.stage === "closed" && app.closedReason !== undefined) {
    db.insert(applicationEvents)
      .values({
        applicationId: app.id,
        at: now - Math.max(1, (app.sentDaysAgo ?? 30) - 10) * DAY_MS,
        detail: null,
        fromValue: "applied",
        id: `${app.id}-event-closed`,
        kind: "stage",
        source: app.closedReason === "no_response" ? "checkin" : "email",
        toValue: "closed",
        userId,
      })
      .onConflictDoNothing()
      .run();
  }

  if (sentAt !== null) {
    db.insert(applicationEvents)
      .values({
        applicationId: app.id,
        at: sentAt,
        detail: null,
        fromValue: "ready",
        id: `${app.id}-event-sent`,
        kind: "status",
        source: "system",
        toValue: "sent",
        userId,
      })
      .onConflictDoNothing()
      .run();
  }
}

async function seedInbox(input: {
  db: AppDatabase;
  now: number;
  personal: PersonalCrypto;
  userId: string;
}) {
  const { db, now, personal, userId } = input;

  db.insert(mailboxes)
    .values({
      createdAt: new Date(now - 120 * DAY_MS),
      firstForwardedAt: new Date(now - 118 * DAY_MS),
      id: DEMO_MAILBOX_ID,
      localPart: DEMO_MAIL_LOCAL_PART,
      status: "active",
      userId,
    })
    .onConflictDoNothing()
    .run();

  const sealed = await Promise.all(
    DEMO_INBOX.map(async (mail, index) => {
      const threadId = `demo-thread-${String(index + 1).padStart(2, "0")}`;
      const messageId = `demo-message-${String(index + 1).padStart(2, "0")}`;
      const at = now - mail.daysAgo * DAY_MS;
      const scope = (column: string) => ({ column, rowId: messageId, table: "messages" });

      return {
        at,
        fromEnc: await personal.sealFor(userId, scope("from_enc"), mail.from),
        mail,
        messageId,
        snippetEnc: await personal.sealFor(userId, scope("snippet_enc"), mail.text),
        subjectEnc: await personal.sealFor(userId, scope("subject_enc"), mail.subject),
        textEnc: await personal.sealFor(userId, scope("text_enc"), mail.text),
        threadId,
        threadSubjectEnc: await personal.sealFor(
          userId,
          { column: "subject_enc", rowId: threadId, table: "mail_threads" },
          mail.subject,
        ),
        toEnc: await personal.sealFor(
          userId,
          scope("to_enc"),
          `${DEMO_MAIL_LOCAL_PART}@tryoverture.com`,
        ),
      };
    }),
  );

  for (const row of sealed) {
    const { at, mail } = row;

    db.insert(mailThreads)
      .values({
        applicationId: mail.applicationId,
        employerStarted: true,
        id: row.threadId,
        lastMessageAt: new Date(at),
        subjectEnc: row.threadSubjectEnc,
        userId,
      })
      .onConflictDoNothing()
      .run();

    db.insert(messages)
      .values({
        auth: "pass",
        classification: mail.classification,
        createdAt: new Date(at),
        direction: "in",
        fromEnc: row.fromEnc,
        id: row.messageId,
        mailboxId: DEMO_MAILBOX_ID,
        rfcMessageId: `<${row.messageId}@${mail.senderDomain}>`,
        senderDomain: mail.senderDomain,
        snippetEnc: row.snippetEnc,
        subjectEnc: row.subjectEnc,
        textEnc: row.textEnc,
        threadId: row.threadId,
        toEnc: row.toEnc,
        userId,
      })
      .onConflictDoNothing()
      .run();
  }
}

function seedInterviews(input: { db: AppDatabase; now: number; userId: string }) {
  const { db, now, userId } = input;
  const ids = DEMO_INTERVIEWS.map((interview) => interview.id);

  const present = db
    .select({ id: interviewEvents.id })
    .from(interviewEvents)
    .where(and(eq(interviewEvents.userId, userId), inArray(interviewEvents.id, ids)))
    .all();

  if (present.length === ids.length) {
    return;
  }

  const today = localDateAt(now, DEMO_TIMEZONE);

  for (const interview of DEMO_INTERVIEWS) {
    const application = db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.id, interview.applicationId), eq(applications.userId, userId)))
      .get();

    const message = db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, interview.messageId), eq(messages.userId, userId)))
      .get();

    if (application === undefined || message === undefined) {
      continue;
    }

    const startsAt = localTimeOn(
      addLocalDays(today, interview.dayOffset),
      interview.hour,
      interview.minute,
      DEMO_TIMEZONE,
    );

    db.insert(interviewEvents)
      .values({
        applicationId: application.id,
        createdAt: now,
        endsAt: startsAt + interview.durationMinutes * 60_000,
        id: interview.id,
        messageId: message.id,
        sequence: 0,
        source: "ics",
        startsAt,
        tz: DEMO_TIMEZONE,
        uid: interview.uid,
        userId,
      })
      .onConflictDoNothing()
      .run();
  }
}

function seedNotifications(input: { db: AppDatabase; now: number; userId: string }) {
  const { db, now, userId } = input;

  for (const [index, notification] of DEMO_NOTIFICATIONS.entries()) {
    const at = now - notification.atDaysAgo * DAY_MS;

    db.insert(notifications)
      .values({
        body: notification.body,
        createdAt: at,
        emailedAt: notification.kind === "ready" ? new Date(at) : null,
        id: `demo-notification-${String(index + 1).padStart(2, "0")}`,
        kind: notification.kind,
        pushedAt: new Date(at),
        readAt: notification.read ? new Date(at) : null,
        title: notification.title,
        url: notification.url,
        userId,
      })
      .onConflictDoNothing()
      .run();
  }
}

function seedReviews(input: { db: AppDatabase; now: number; userId: string }) {
  const { db, now, userId } = input;

  const reviewRows = [
    {
      applicationIds: ["demo-app-04", "demo-app-05"],
      factKey: "salary_expectation",
      fieldType: "text" as const,
      id: "demo-review-01",
      prompt: "What are your salary expectations for this role?",
      scope: "CAD",
    },
    {
      applicationIds: ["demo-app-04"],
      factKey: "security_clearance",
      fieldType: "select" as const,
      id: "demo-review-02",
      prompt: "Do you hold a security clearance?",
      options: ["Yes, active", "No"],
      scope: "",
    },
    {
      applicationIds: ["demo-app-05"],
      factKey: "on_call_comfort",
      fieldType: "select" as const,
      id: "demo-review-03",
      prompt: "Are you comfortable participating in an on-call rotation?",
      options: ["Yes", "No"],
      scope: "",
    },
  ];

  for (const [index, review] of reviewRows.entries()) {
    const questionId = ensureQuestion({
      db,
      input: {
        factKey: review.factKey,
        fieldType: review.fieldType === "select" ? "text" : review.fieldType,
        text: review.prompt,
      },
      now,
    });

    db.insert(reviews)
      .values({
        createdAt: now - (index + 1) * DAY_MS,
        factKey: review.factKey,
        fieldType: review.fieldType,
        id: review.id,
        options: JSON.stringify(review.options ?? []),
        prompt: review.prompt,
        questionId,
        reason: "unknown_required",
        resolvedAt: null,
        scope: review.scope,
        status: "open",
        userId,
      })
      .onConflictDoNothing()
      .run();

    for (const applicationId of review.applicationIds) {
      db.insert(reviewApplications)
        .values({ applicationId, reviewId: review.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

function seedCheckins(input: { db: AppDatabase; now: number; userId: string }) {
  const { db, now, userId } = input;

  db.insert(checkins)
    .values({
      answer: null,
      applicationId: "demo-app-12",
      createdAt: now - 42 * DAY_MS,
      dueAt: now - 39 * DAY_MS,
      id: "demo-checkin-01",
      status: "open",
      userId,
    })
    .onConflictDoNothing()
    .run();

  db.insert(checkins)
    .values({
      answer: "still_waiting",
      applicationId: "demo-app-18",
      createdAt: now - 95 * DAY_MS,
      dueAt: now - 92 * DAY_MS,
      id: "demo-checkin-02",
      status: "answered",
      userId,
    })
    .onConflictDoNothing()
    .run();
}

function seedLedger(input: { db: AppDatabase; clock: Clock; userId: string }) {
  const { db, clock, userId } = input;

  const grant = grantApplications(db, clock, {
    expiresAt: clock.now() + 30 * DAY_MS,
    idempotencyKey: `demo-grant:${userId}`,
    quantity: 300,
    source: "admin",
    startsAt: clock.now() - 120 * DAY_MS,
    userId,
  });

  const sent = DEMO_APPLICATIONS.filter((app) => app.sentDaysAgo !== undefined);

  for (const app of sent) {
    const at = demoSentAt(clock.now(), app.sentDaysAgo ?? 0);

    postLedgerEntry(db, at, {
      amount: 1,
      applicationId: app.id,
      grantId: grant.grantId,
      idempotencyKey: `demo-reserve:${userId}:${app.id}`,
      kind: "reserve",
      userId,
    });

    postLedgerEntry(db, at + 1, {
      amount: 1,
      applicationId: app.id,
      grantId: grant.grantId,
      idempotencyKey: `demo-commit:${userId}:${app.id}`,
      kind: "commit",
      userId,
    });
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}
