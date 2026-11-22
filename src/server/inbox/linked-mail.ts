import { and, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { mailThreads } from "../platform/db/schema.ts";
import { messagesByThreadOf } from "./threads.ts";

/**
 * The mail threads linked to an Application, with every message of every
 * thread read in one query rather than one per thread.
 * @param input The database, the person's crypto and the Application.
 * @returns One view per thread, newest thread first.
 */
export async function linkedMailOf(input: {
  applicationId: string;
  db: AppDatabase;
  personal: PersonalCrypto;
  userId: string;
}) {
  const { applicationId, db, personal, userId } = input;

  const threads = db
    .select()
    .from(mailThreads)
    .where(and(eq(mailThreads.userId, userId), eq(mailThreads.applicationId, applicationId)))
    .orderBy(desc(mailThreads.lastMessageAt))
    .all();

  const messagesByThread = messagesByThreadOf(
    db,
    threads.map((thread) => thread.id),
  );

  return Promise.all(
    threads.map(async (thread) => {
      const subject = await personal.openFor(
        userId,
        { column: "subject_enc", rowId: thread.id, table: "mail_threads" },
        thread.subjectEnc,
      );

      const rows = messagesByThread.get(thread.id) ?? [];

      const items = await Promise.all(
        rows.map(async (message) => {
          const [from, snippet, messageSubject] = await Promise.all([
            personal.openFor(
              userId,
              { column: "from_enc", rowId: message.id, table: "messages" },
              message.fromEnc,
            ),
            personal.openFor(
              userId,
              { column: "snippet_enc", rowId: message.id, table: "messages" },
              message.snippetEnc,
            ),
            personal.openFor(
              userId,
              { column: "subject_enc", rowId: message.id, table: "messages" },
              message.subjectEnc,
            ),
          ]);

          return {
            at: message.createdAt.getTime(),
            classification: message.classification,
            direction: message.direction,
            from,
            id: message.id,
            snippet,
            subject: messageSubject,
          };
        }),
      );

      return {
        id: thread.id,
        lastMessageAt: thread.lastMessageAt.getTime(),
        messages: items,
        subject,
      };
    }),
  );
}
