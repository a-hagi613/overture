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
import { linkedMailOf } from "./linked-mail.ts";

const NOW = 1_795_000_000_000;
const USER = "linked-mail-user";

function seeded() {
  const { counter, db } = openCountingDatabase();

  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Mail Owner",
      email: "mail@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    })
    .run();

  db.insert(mailboxes)
    .values({ id: "mailbox-1", userId: USER, localPart: "mail", createdAt: at })
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

  db.insert(postings)
    .values({
      id: "posting-1",
      boardId: "board-1",
      companyId: "co-1",
      ats: "greenhouse",
      atsJobId: "job-1",
      url: "https://example.test/job-1",
      applyUrlNorm: "https://example.test/job-1",
      title: "Platform Engineer",
      titleNorm: "platform engineer",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      dedupeKey: "job-1",
    })
    .run();

  db.insert(applications)
    .values({
      id: "app-1",
      userId: USER,
      postingId: "posting-1",
      companyId: "co-1",
      origin: "auto",
      status: "sent",
      stage: "applied",
      sentAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();

  return { counter, db, personal: createPersonalCrypto(db, new Uint8Array(32).fill(8), 1) };
}

async function addThread(
  db: AppDatabase,
  personal: ReturnType<typeof createPersonalCrypto>,
  index: number,
) {
  const threadId = `thread-${String(index)}`;
  const at = NOW - index * 60_000;

  db.insert(mailThreads)
    .values({
      id: threadId,
      userId: USER,
      applicationId: "app-1",
      subjectEnc: await personal.sealFor(
        USER,
        { column: "subject_enc", rowId: threadId, table: "mail_threads" },
        `Thread ${String(index)}`,
      ),
      lastMessageAt: new Date(at),
    })
    .run();

  const sealedMessages = await Promise.all(
    Array.from({ length: 3 }, async (_unused, offset) => {
      const messageId = `msg-${String(index)}-${String(offset)}`;

      const [fromEnc, toEnc, subjectEnc, textEnc, snippetEnc] = await Promise.all([
        personal.sealFor(
          USER,
          { column: "from_enc", rowId: messageId, table: "messages" },
          "Hiring <hiring@example.test>",
        ),
        personal.sealFor(
          USER,
          { column: "to_enc", rowId: messageId, table: "messages" },
          "mail@example.test",
        ),
        personal.sealFor(
          USER,
          { column: "subject_enc", rowId: messageId, table: "messages" },
          `Reply ${String(index)}`,
        ),
        personal.sealFor(
          USER,
          { column: "text_enc", rowId: messageId, table: "messages" },
          `Body ${String(offset)}`,
        ),
        personal.sealFor(
          USER,
          { column: "snippet_enc", rowId: messageId, table: "messages" },
          `Snippet ${String(offset)}`,
        ),
      ]);

      return { fromEnc, messageId, offset, snippetEnc, subjectEnc, textEnc, toEnc };
    }),
  );

  for (const message of sealedMessages) {
    db.insert(messages)
      .values({
        id: message.messageId,
        threadId,
        userId: USER,
        mailboxId: "mailbox-1",
        direction: message.offset === 0 ? "in" : "out",
        rfcMessageId: `<${message.messageId}@example.test>`,
        senderDomain: "example.test",
        auth: "pass",
        fromEnc: message.fromEnc,
        toEnc: message.toEnc,
        subjectEnc: message.subjectEnc,
        textEnc: message.textEnc,
        snippetEnc: message.snippetEnc,
        createdAt: new Date(at + message.offset),
      })
      .run();
  }
}

describe("an Application's linked mail", () => {
  test("reads its Threads in one set of statements, not one set per Thread", async () => {
    const { counter, db, personal } = seeded();

    await addThread(db, personal, 0);
    await linkedMailOf({ applicationId: "app-1", db, personal, userId: USER });
    counter.reset();

    const one = await linkedMailOf({ applicationId: "app-1", db, personal, userId: USER });
    const statementsForOne = counter.count();

    await Promise.all(
      Array.from({ length: 4 }, async (_unused, offset) => addThread(db, personal, offset + 1)),
    );

    counter.reset();

    const five = await linkedMailOf({ applicationId: "app-1", db, personal, userId: USER });

    expect(one).toHaveLength(1);
    expect(five).toHaveLength(5);
    expect(counter.count()).toBe(statementsForOne);
    expect(statementsForOne).toBeLessThanOrEqual(4);
  });

  test("keeps every message of every thread in time order, newest thread first", async () => {
    const { db, personal } = seeded();

    await addThread(db, personal, 0);
    await addThread(db, personal, 1);

    const threads = await linkedMailOf({ applicationId: "app-1", db, personal, userId: USER });

    expect(threads.map((thread) => thread.id)).toEqual(["thread-0", "thread-1"]);
    expect(threads[0]?.messages.map((message) => message.id)).toEqual([
      "msg-0-0",
      "msg-0-1",
      "msg-0-2",
    ]);
    expect(threads[0]).toMatchObject({ subject: "Thread 0" });
  });
});
