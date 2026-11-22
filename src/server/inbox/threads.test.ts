import { describe, expect, test } from "bun:test";

import { openCountingDatabase } from "../testing/query-counter.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import {
  applications,
  companies,
  companyBoards,
  mailThreads,
  mailboxes,
  messages,
  postings,
  users,
} from "../platform/db/schema.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { threadViewsOf } from "./threads.ts";

const NOW = 1_795_000_000_000;
const USER = "inbox-user";

function seeded() {
  const { counter, db } = openCountingDatabase();

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

  db.insert(companies)
    .values({ id: "co-1", name: "Northwind", nameNorm: "northwind", createdAt: NOW })
    .run();

  db.insert(companyBoards)
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

  const personal = createPersonalCrypto(db, new Uint8Array(32).fill(3), 1);

  return { counter, db, personal };
}

async function addThread(
  db: AppDatabase,
  personal: ReturnType<typeof createPersonalCrypto>,
  input: { application: boolean; index: number; unread: boolean },
) {
  const at = NOW - input.index * 60_000;
  const threadId = `thread-${String(input.index)}`;
  const applicationId = `app-${String(input.index)}`;

  if (input.application) {
    db.insert(postings)
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
        auth: "pass",
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

describe("the Inbox thread list", () => {
  test("keeps one set of statements however many Threads the person has", async () => {
    const { counter, db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 3 }, async (_unused, index) =>
        addThread(db, personal, { application: index % 2 === 0, index, unread: index % 3 === 0 }),
      ),
    );

    await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });
    counter.reset();

    const three = await threadViewsOf({ db, personal, threads: threadsOf(db), userId: USER });
    const statementsForThree = counter.count();

    await Promise.all(
      Array.from({ length: 9 }, async (_unused, offset) =>
        addThread(db, personal, {
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

  test("reads the latest message, the employer and the unread flag for every Thread", async () => {
    const { db, personal } = seeded();

    await Promise.all(
      Array.from({ length: 4 }, async (_unused, index) =>
        addThread(db, personal, { application: index % 2 === 0, index, unread: index === 0 }),
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
});
