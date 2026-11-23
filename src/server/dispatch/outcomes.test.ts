import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import {
  applicationReceipts,
  applications,
  attempts,
  mailThreads,
  mailboxes,
  messages,
  users,
} from "../platform/db/schema.ts";
import {
  applicationsLeft,
  committedSince,
  grantApplications,
  reserveForApplication,
} from "../billing/ledger.ts";
import { sealApprovedPlan } from "../pipeline/approved-plan.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

import { createOutcomes } from "./outcomes.ts";

import type { SendPlan } from "../pipeline/send-plan.ts";

function startInMemoryOutcomes() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();

  const personal = createPersonalCrypto(
    db,
    masterKeyringFor(crypto.getRandomValues(new Uint8Array(32))),
  );

  const outcomes = createOutcomes({ db, clock, personal });
  const userId = "user-1";
  const instant = clock.now();
  const seededCompanies = new Map<string, { boardId: string; companyId: string }>();
  let sequence = 0;

  db.insert(users)
    .values({
      createdAt: new Date(instant),
      email: "maya.okafor@example.com",
      emailVerified: true,
      id: userId,
      name: "Maya Okafor",
      role: "user",
      updatedAt: new Date(instant),
    })
    .run();
  db.insert(mailboxes)
    .values({
      createdAt: new Date(instant),
      id: "mailbox-1",
      localPart: "maya",
      userId,
    })
    .run();
  grantApplications(db, clock, {
    idempotencyKey: "grant:1",
    quantity: 3,
    source: "admin",
    startsAt: instant,
    userId,
  });

  function companyFor(input: { domain: string; id?: string; name: string }) {
    const key = input.id ?? input.name;
    const seeded = seededCompanies.get(key);

    if (seeded !== undefined) {
      return seeded;
    }

    sequence += 1;

    const companyId = input.id ?? `company-${String(sequence)}`;
    const boardId = `board-${String(sequence)}`;

    seededCompanies.set(key, { boardId, companyId });

    return { boardId, companyId };
  }

  async function confirmingApplication(input: {
    company: { domain: string; id?: string; name: string };
    submittedAt?: number;
    title: string;
  }) {
    const { companyId } = companyFor(input.company);
    const submittedAt = input.submittedAt ?? instant;

    sequence += 1;

    const postingId = `posting-${String(sequence)}`;
    const applicationId = `application-${String(sequence)}`;

    const plan = {
      applicationId,
      ats: "greenhouse",
      atsJobId: `job-${String(sequence)}`,
      boardToken: `token-${String(sequence)}`,
      companyName: input.company.name,
      consentVersion: "m2",
      coverLetter: null,
      descriptionHash: null,
      fields: [],
      postingTitle: input.title,
      postingUrl: `https://example.test/${String(sequence)}`,
      resume: null,
      userId,
    } satisfies SendPlan;

    const sealed = await sealApprovedPlan({ applicationId, personal, plan });

    db.insert(applications)
      .values({
        approvedAt: submittedAt,
        approvedPlanEnc: sealed.enc,
        approvedPlanSha256: sealed.sha256,
        ats: "greenhouse",
        companyDomain: input.company.domain,
        companyId,
        companyName: input.company.name,
        companyNameNorm: input.company.name.toLowerCase(),
        createdAt: submittedAt,
        id: applicationId,
        origin: "auto",
        postingId,
        postingTitle: input.title,
        postingUrl: `https://example.test/${String(sequence)}`,
        status: "confirming",
        updatedAt: submittedAt,
        userId,
      })
      .run();
    db.insert(attempts)
      .values({
        applicationId,
        id: `attempt-${String(sequence)}`,
        leaseUntil: submittedAt + 60_000,
        n: 1,
        provider: "local",
        startedAt: submittedAt,
        submitClickedAt: submittedAt,
        userId,
      })
      .run();
    reserveForApplication(db, clock, {
      applicationId,
      idempotencyKey: `reserve:${applicationId}`,
      userId,
    });

    return { applicationId };
  }

  async function message(input: {
    createdAt?: number;
    senderDomain: string;
    subject: string;
    text: string;
  }) {
    sequence += 1;

    const threadId = `thread-${String(sequence)}`;
    const messageId = `message-${String(sequence)}`;
    const createdAt = input.createdAt ?? instant + 60_000;
    const scope = (column: string) => ({ column, rowId: messageId, table: "messages" });
    const subjectEnc = await personal.sealFor(userId, scope("subject_enc"), input.subject);
    const textEnc = await personal.sealFor(userId, scope("text_enc"), input.text);
    const bodyEnc = await personal.sealFor(userId, scope("body_enc"), input.text);

    db.insert(mailThreads)
      .values({
        id: threadId,
        lastMessageAt: new Date(createdAt),
        subjectEnc,
        userId,
      })
      .run();
    db.insert(messages)
      .values({
        auth: "pass",
        createdAt: new Date(createdAt),
        direction: "in",
        fromEnc: bodyEnc,
        id: messageId,
        mailboxId: "mailbox-1",
        rfcMessageId: `<${messageId}@example.test>`,
        senderDomain: input.senderDomain,
        snippetEnc: bodyEnc,
        subjectEnc,
        textEnc,
        threadId,
        toEnc: bodyEnc,
        userId,
      })
      .run();

    return messageId;
  }

  return {
    advance: (milliseconds: number) => {
      clock.setOffset(clock.offset() + milliseconds);
    },
    applicationsLeft: () => applicationsLeft(db, userId, clock.now()),
    committed: () => committedSince(db, userId, 0),
    confirmedCount: () =>
      db.select().from(applications).where(eq(applications.status, "sent")).all().length,
    confirmingApplication,
    instant,
    message,
    outcomes,
    receiptMessageOf: (applicationId: string) =>
      db
        .select({ messageId: applicationReceipts.messageId })
        .from(applicationReceipts)
        .where(eq(applicationReceipts.applicationId, applicationId))
        .get()?.messageId ?? null,
    recordReceipt: (input: { applicationId: string; messageId: string }) =>
      db
        .insert(applicationReceipts)
        .values({ ...input, confirmedAt: clock.now() })
        .run(),
    statusOf: (applicationId: string) =>
      db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, applicationId))
        .get()?.status ?? null,
    userId,
  };
}

describe("email receipt matching", () => {
  test("leaves two confirming applications at one employer unresolved when the acknowledgement names only the company", async () => {
    const harness = startInMemoryOutcomes();

    const role = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Assistant General Manager | Durham",
    });

    const other = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Store Manager | Raleigh",
    });

    const messageId = await harness.message({
      senderDomain: "blankstreet.example",
      subject: "Your application to Blank Street",
      text: "Thank you for applying to Blank Street. We received your application.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(
      false,
    );

    expect(harness.statusOf(role.applicationId)).toBe("confirming");
    expect(harness.statusOf(other.applicationId)).toBe("confirming");
    expect(harness.receiptMessageOf(role.applicationId)).toBeNull();
    expect(harness.receiptMessageOf(other.applicationId)).toBeNull();
    expect(harness.committed()).toBe(0);
    expect(harness.applicationsLeft()).toBe(1);
  });

  test("leaves two applications at one employer unresolved when the acknowledgement names only the role", async () => {
    const harness = startInMemoryOutcomes();

    const role = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Assistant General Manager | Durham",
    });

    const other = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Store Manager | Raleigh",
    });

    const messageId = await harness.message({
      senderDomain: "us.greenhouse-mail.io",
      subject: "Your application",
      text: "Thank you for applying for the Assistant General Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(
      false,
    );

    expect(harness.statusOf(role.applicationId)).toBe("confirming");
    expect(harness.statusOf(other.applicationId)).toBe("confirming");
    expect(harness.receiptMessageOf(role.applicationId)).toBeNull();
    expect(harness.committed()).toBe(0);
  });

  test("leaves an acknowledgement naming only the role unresolved across duplicate employer rows", async () => {
    const harness = startInMemoryOutcomes();

    const role = await harness.confirmingApplication({
      company: { domain: "northwind.example", id: "company-northwind-a", name: "Northwind" },
      title: "Assistant General Manager | Durham",
    });

    const other = await harness.confirmingApplication({
      company: { domain: "northwind.example", id: "company-northwind-b", name: "Northwind" },
      title: "Store Manager | Raleigh",
    });

    const messageId = await harness.message({
      senderDomain: "us.greenhouse-mail.io",
      subject: "Your application",
      text: "Thank you for applying for the Assistant General Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(
      false,
    );

    expect(harness.statusOf(role.applicationId)).toBe("confirming");
    expect(harness.statusOf(other.applicationId)).toBe("confirming");
    expect(harness.committed()).toBe(0);
  });

  test("leaves two applications with the same title at one employer unresolved", async () => {
    const harness = startInMemoryOutcomes();

    const first = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Operations Manager",
    });

    const second = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Operations Manager",
    });

    const messageId = await harness.message({
      senderDomain: "blankstreet.example",
      subject: "Your application to Blank Street",
      text: "Thank you for applying to Blank Street for the Operations Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(
      false,
    );

    expect(harness.statusOf(first.applicationId)).toBe("confirming");
    expect(harness.statusOf(second.applicationId)).toBe("confirming");
    expect(harness.receiptMessageOf(first.applicationId)).toBeNull();
    expect(harness.receiptMessageOf(second.applicationId)).toBeNull();
    expect(harness.committed()).toBe(0);
  });

  test("confirms only the role the acknowledgement names when two applications share an employer", async () => {
    const harness = startInMemoryOutcomes();

    const other = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Store Manager | Raleigh",
    });

    const role = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Assistant General Manager | Durham",
    });

    const messageId = await harness.message({
      senderDomain: "blankstreet.example",
      subject: "Your application to Blank Street",
      text: "Thank you for applying to Blank Street for the Assistant General Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(true);

    expect(harness.statusOf(role.applicationId)).toBe("sent");
    expect(harness.statusOf(other.applicationId)).toBe("confirming");
    expect(harness.confirmedCount()).toBe(1);
    expect(harness.committed()).toBe(1);
    expect(harness.receiptMessageOf(role.applicationId)).toBe(messageId);
    expect(harness.receiptMessageOf(other.applicationId)).toBeNull();
  });

  test("leaves applications with the same title at two employers unresolved when the acknowledgement names only the title", async () => {
    const harness = startInMemoryOutcomes();

    const northwind = await harness.confirmingApplication({
      company: { domain: "northwind.example", name: "Northwind" },
      title: "Operations Manager",
    });

    const contoso = await harness.confirmingApplication({
      company: { domain: "contoso.example", name: "Contoso" },
      title: "Operations Manager",
    });

    const messageId = await harness.message({
      senderDomain: "us.greenhouse-mail.io",
      subject: "Your application",
      text: "Thank you for applying for the Operations Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(
      false,
    );

    expect(harness.confirmedCount()).toBe(0);
    expect(harness.committed()).toBe(0);
    expect(harness.receiptMessageOf(northwind.applicationId)).toBeNull();
    expect(harness.receiptMessageOf(contoso.applicationId)).toBeNull();
  });

  test("uses the employer named alongside the shared title to confirm exactly one application", async () => {
    const harness = startInMemoryOutcomes();

    await harness.confirmingApplication({
      company: { domain: "northwind.example", name: "Northwind" },
      title: "Operations Manager",
    });

    const role = await harness.confirmingApplication({
      company: { domain: "contoso.example", name: "Contoso" },
      title: "Operations Manager",
    });

    const messageId = await harness.message({
      senderDomain: "us.greenhouse-mail.io",
      subject: "Your application to Contoso",
      text: "Thank you for applying to Contoso for the Operations Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(true);

    expect(harness.statusOf(role.applicationId)).toBe("sent");
    expect(harness.confirmedCount()).toBe(1);
    expect(harness.committed()).toBe(1);
    expect(harness.receiptMessageOf(role.applicationId)).toBe(messageId);
  });

  test("a receipt message confirms one application, commits one credit and is never reused", async () => {
    const harness = startInMemoryOutcomes();

    const role = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      title: "Assistant General Manager | Durham",
    });

    const messageId = await harness.message({
      senderDomain: "blankstreet.example",
      subject: "Your application to Blank Street",
      text: "Thank you for applying to Blank Street for the Assistant General Manager role.",
    });

    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(true);
    expect(await harness.outcomes.confirmMessage({ messageId, userId: harness.userId })).toBe(
      false,
    );

    const other = await harness.confirmingApplication({
      company: { domain: "blankstreet.example", name: "Blank Street" },
      submittedAt: harness.instant - 60_000,
      title: "Store Manager | Raleigh",
    });

    await harness.outcomes.expireConfirming();

    expect(harness.statusOf(other.applicationId)).toBe("confirming");
    expect(harness.committed()).toBe(1);
    expect(harness.applicationsLeft()).toBe(1);

    harness.advance(25 * 60 * 60_000);
    await harness.outcomes.expireConfirming();

    expect(harness.statusOf(other.applicationId)).toBe("failed");
    expect(harness.committed()).toBe(1);
    expect(harness.applicationsLeft()).toBe(2);
    expect(harness.receiptMessageOf(role.applicationId)).toBe(messageId);
    expect(harness.receiptMessageOf(other.applicationId)).toBeNull();
    expect(() =>
      harness.recordReceipt({ applicationId: other.applicationId, messageId }),
    ).toThrow();
  });
});
