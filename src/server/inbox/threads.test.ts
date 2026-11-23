import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import { applications, mailThreads, mailboxes, messages, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import type { InboxThreadCounts } from "./threads.ts";
import { threadCountsOf, threadPageOf, threadViewsOf, unreadThreadCountOf } from "./threads.ts";

const NOW = 1_795_000_000_000;
const USER = "inbox-user";
const { db: seedCatalogDb } = openCatalogDatabase(":memory:");

migrateCatalogDatabase(seedCatalogDb, "drizzle-catalog");

function seeded() {
  const { counter, db } = openCountingDatabase();

  seedCatalogDb.delete(companies).run();

  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Inbox Owner",
      email: "inbox@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    })
    .run();

  db.insert(mailboxes)
    .values({ id: "mailbox-1", userId: USER, localPart: "inbox", createdAt: at })
    .run();

  seedCatalogDb
    .insert(companies)
    .values({ id: "co-1", name: "Northwind", nameNorm: "northwind", createdAt: NOW })
    .run();

  seedCatalogDb
    .insert(companyBoards)
    .values({
      id: "board-1",
      companyId: "co-1",
      ats: "greenhouse",
      boardToken: "board-1",
      region: "us",
      source: "v1_seed",
      lastPolledAt: NOW,
      createdAt: NOW,
    })
    .run();

  const personal = createPersonalCrypto(db, masterKeyringFor(new Uint8Array(32).fill(3)));

  return { catalogDb: seedCatalogDb, counter, db, personal };
}

async function addThread(
  db: AppDatabase,
  catalogDbToSeed: typeof seedCatalogDb,
  personal: ReturnType<typeof createPersonalCrypto>,
  input: { application: boolean; failAuth?: boolean; index: number; unread: boolean },
) {
  const at = NOW - input.index * 60_000;
  const threadId = `thread-${String(input.index)}`;
  const applicationId = `app-${String(input.index)}`;

  if (input.application) {
    catalogDbToSeed
      .insert(postings)
      .values({
        id: `posting-${String(input.index)}`,
        boardId: "board-1",
        companyId: "co-1",
        ats: "greenhouse",
        atsJobId: `job-${String(input.index)}`,
        url: `https://example.test/job-${String(input.index)}`,
        applyUrlNorm: `https://example.test/job-${String(input.index)}`,
        title: "Platform Engineer",
        titleNorm: "platform engineer",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        dedupeKey: `job-${String(input.index)}`,
      })
      .run();

    db.insert(applications)
      .values({
        id: applicationId,
        userId: USER,
        postingId: `posting-${String(input.index)}`,
        companyId: "co-1",
        companyName: "Northwind",
        companyNameNorm: "northwind",
        postingTitle: "Platform Engineer",
        postingUrl: `https://example.test/job-${String(input.index)}`,
        origin: "auto",
        status: "sent",
        stage: "applied",
        sentAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .run();
  }

  db.insert(mailThreads)
    .values({
      id: threadId,
      userId: USER,
      applicationId: input.application ? applicationId : null,
      subjectEnc: await personal.sealFor(
        USER,
        { column: "subject_enc", rowId: threadId, table: "mail_threads" },
        "Thread subject",
      ),
      lastMessageAt: new Date(at),
    })
    .run();

  const sealedMessages = await Promise.all(
    (["in", "out"] as const).map(async (direction) => {
      const messageId = `msg-${String(input.index)}-${direction}`;

      const [fromEnc, toEnc, subjectEnc, textEnc, snippetEnc] = await Promise.all([
        personal.sealFor(
          USER,
          { column: "from_enc", rowId: messageId, table: "messages" },
          `Hiring Team ${String(input.index)} <hiring${String(input.index)}@example.test>`,
        ),
        personal.sealFor(
          USER,
          { column: "to_enc", rowId: messageId, table: "messages" },
          "inbox@example.test",
        ),
        personal.sealFor(
          USER,
          { column: "subject_enc", rowId: messageId, table: "messages" },
          `Reply ${String(input.index)}`,
        ),
        personal.sealFor(
          USER,
          { column: "text_enc", rowId: messageId, table: "messages" },
          `Body ${direction} ${String(input.index)}`,
        ),
        personal.sealFor(
          USER,
          { column: "snippet_enc", rowId: messageId, table: "messages" },
          `Snippet ${direction} ${String(input.index)}`,
        ),
      ]);

      return { direction, fromEnc, messageId, snippetEnc, subjectEnc, textEnc, toEnc };
    }),
  );

  for (const message of sealedMessages) {
    db.insert(messages)
      .values({
        id: message.messageId,
        threadId,
        userId: USER,
        mailboxId: "mailbox-1",
        direction: message.direction,
        rfcMessageId: `<${message.messageId}@example.test>`,
        senderDomain: "example.test",
        auth: input.failAuth === true ? "fail" : "pass",
        fromEnc: message.fromEnc,
        toEnc: message.toEnc,
        subjectEnc: message.subjectEnc,
        textEnc: message.textEnc,
        snippetEnc: message.snippetEnc,
        classification: "screening",
        readAt: message.direction === "in" && input.unread ? null : new Date(at),
        createdAt: new Date(at + (message.direction === "in" ? 0 : 1000)),
      })
      .run();
  }
}

function threadsOf(db: AppDatabase) {
  return db.select().from(mailThreads).orderBy(mailThreads.lastMessageAt).all();
}

interface ThreadPageOfTest {
  counts: InboxThreadCounts;
  ids: string[];
}

const threadPages: (
  db: AppDatabase,
  personal: ReturnType<typeof createPersonalCrypto>,
  limit: number,
  cursor: { before: number | null; beforeId: string | null },
  pages: readonly ThreadPageOfTest[],
) => Promise<ThreadPageOfTest[]> = async (db, personal, limit, cursor, pages) => {
  const page = await threadPageOf({ ...cursor, db, limit, personal, userId: USER });

  const collected = [
    ...pages,
    { counts: page.counts, ids: page.threads.map((thread) => thread.id) },
  ];

  if (page.nextCursor === null || page.nextCursorId === null) {
    return collected;
  }

  return threadPages(
    db,
    personal,
    limit,
    { before: page.nextCursor, beforeId: page.nextCursorId },
    collected,
  );
};

describe("the Inbox thread list", () => {
  test("keeps one set of statements however many Threads the person has", async () => {
    const { catalogDb, counter, db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 3 }, async (_unused, index) =>
        addThread(db, catalogDb, personal, {
          application: index % 2 === 0,
          index,
          unread: index % 3 === 0,
        }),
      ),
    );

    await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });
    counter.reset();

    const three = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });
    const statementsForThree = counter.count();

    await Promise.all(
      Array.from({ length: 9 }, async (_unused, offset) =>
        addThread(db, catalogDb, personal, {
          application: (offset + 3) % 2 === 0,
          index: offset + 3,
          unread: (offset + 3) % 3 === 0,
        }),
      ),
    );

    counter.reset();

    const twelve = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });

    expect(three).toHaveLength(3);
    expect(twelve).toHaveLength(12);
    expect(counter.count()).toBe(statementsForThree);
    expect(statementsForThree).toBeLessThanOrEqual(4);
  });

  test("counts a Thread once however many unread Messages it holds", async () => {
    const { catalogDb, db, personal } = seeded();

    await addThread(db, catalogDb, personal, { application: false, index: 0, unread: true });
    await addThread(db, catalogDb, personal, { application: false, index: 1, unread: false });

    const messageId = "msg-0-second-unread";

    const scope = (column: string) => ({ column, rowId: messageId, table: "messages" });

    const [fromEnc, toEnc, subjectEnc, textEnc, snippetEnc] = await Promise.all([
      personal.sealFor(USER, scope("from_enc"), "Hiring Team <hiring@example.test>"),
      personal.sealFor(USER, scope("to_enc"), "inbox@example.test"),
      personal.sealFor(USER, scope("subject_enc"), "Another reply"),
      personal.sealFor(USER, scope("text_enc"), "The second unread body"),
      personal.sealFor(USER, scope("snippet_enc"), "The second unread body"),
    ]);

    db.insert(messages)
      .values({
        auth: "pass",
        classification: "screening",
        createdAt: new Date(NOW + 2000),
        direction: "in",
        fromEnc,
        id: messageId,
        mailboxId: "mailbox-1",
        readAt: null,
        rfcMessageId: `<${messageId}@example.test>`,
        senderDomain: "example.test",
        snippetEnc,
        subjectEnc,
        textEnc,
        threadId: "thread-0",
        toEnc,
        userId: USER,
      })
      .run();

    const views = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });

    expect(views.filter((view) => view.unread)).toHaveLength(1);
    expect(unreadThreadCountOf(db, USER)).toBe(1);
  });

  test("reads the latest message, the employer and the unread flag for every Thread", async () => {
    const { catalogDb, db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 4 }, async (_unused, index) =>
        addThread(db, catalogDb, personal, {
          application: index % 2 === 0,
          index,
          unread: index === 0,
        }),
      ),
    );

    const views = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });

    const first = views.find((view) => view.id === "thread-0");

    expect(first).toEqual({
      applicationId: "app-0",
      classification: "screening",
      company: "Northwind",
      id: "thread-0",
      lastMessageAt: NOW,
      needsChecking: false,
      snippet: "Snippet out 0",
      subject: "Reply 0",
      title: "Platform Engineer",
      unread: true,
    });

    const second = views.find((view) => view.id === "thread-1");

    expect(second).toMatchObject({ company: "Hiring Team 1", title: null, unread: false });
  });

  test("pages every Thread once and keeps the counts over all of them", async () => {
    const { catalogDb, db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 9 }, async (_unused, index) =>
        addThread(db, catalogDb, personal, {
          application: index % 3 === 0,
          failAuth: index % 4 === 1,
          index,
          unread: index % 5 === 0,
        }),
      ),
    );

    const views = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });

    const expected = {
      all: views.length,
      needsChecking: views.filter((view) => view.needsChecking).length,
      unread: views.filter((view) => view.unread).length,
    };

    expect(threadCountsOf(db, USER)).toEqual(expected);

    const pages = await threadPages(db, personal, 2, { before: null, beforeId: null }, []);
    const seen = pages.flatMap((page) => page.ids);

    for (const page of pages) {
      expect(page.counts).toEqual(expected);
    }

    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect(seen).toEqual(views.map((view) => view.id).toReversed());
  });

  test("breaks a shared timestamp by Thread id so a page boundary loses nothing", async () => {
    const { catalogDb, db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 3 }, async (_unused, index) =>
        addThread(db, catalogDb, personal, { application: false, index, unread: false }),
      ),
    );

    db.update(mailThreads)
      .set({ lastMessageAt: new Date(NOW) })
      .run();

    const pages = await threadPages(db, personal, 1, { before: null, beforeId: null }, []);
    const seen = pages.flatMap((page) => page.ids);

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  test("keeps the employer and title after the catalog drops the Posting and Company", async () => {
    const { catalogDb, db, personal } = seeded();

    await addThread(db, catalogDb, personal, { application: true, index: 0, unread: false });

    catalogDb.delete(companies).where(eq(companies.id, "co-1")).run();

    expect(catalogDb.select().from(postings).all()).toHaveLength(0);

    const views = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });

    expect(views[0]).toMatchObject({ company: "Northwind", title: "Platform Engineer" });
  });
});
