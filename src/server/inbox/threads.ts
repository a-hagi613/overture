import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import type { mailThreads } from "../platform/db/schema.ts";
import { applications, messageAttachments, messages } from "../platform/db/schema.ts";

type ThreadRow = typeof mailThreads.$inferSelect;

type MessageRow = typeof messages.$inferSelect;

type AttachmentRow = typeof messageAttachments.$inferSelect;

export interface InboxThreadView {
  applicationId: string | null;
  classification: string | null;
  company: string;
  id: string;
  lastMessageAt: number;
  needsChecking: boolean;
  snippet: string;
  subject: string;
  title: string | null;
  unread: boolean;
}

function displayNameOf(from: string) {
  const open = from.indexOf("<");

  if (open === -1) {
    return from.trim();
  }

  const name = from.slice(0, open).trim().replaceAll(/^"|"$/gu, "");

  return name === "" ? from.trim() : name;
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = keyOf(row);
    const list = grouped.get(key) ?? [];

    list.push(row);
    grouped.set(key, list);
  }

  return grouped;
}

/**
 * Every Thread's messages in one read, grouped by Thread and kept in time order.
 * @param db The database to read.
 * @param threadIds The Threads on screen.
 * @returns The messages of each Thread.
 */
export function messagesByThreadOf(db: AppDatabase, threadIds: readonly string[]) {
  if (threadIds.length === 0) {
    return new Map<string, MessageRow[]>();
  }

  const rows = db
    .select()
    .from(messages)
    .where(inArray(messages.threadId, [...threadIds]))
    .orderBy(asc(messages.createdAt))
    .all();

  return groupBy(rows, (row) => row.threadId);
}

/**
 * The employer and title behind each Thread's Application, in one read.
 * @param db The database to read.
 * @param userId The person the Applications belong to.
 * @param applicationIds The Applications on screen.
 * @returns The employer and title by Application id.
 */
export function applicationsByIdOf(
  db: AppDatabase,
  userId: string,
  applicationIds: readonly string[],
) {
  const found = new Map<string, { company: string; title: string }>();

  if (applicationIds.length === 0) {
    return found;
  }

  const rows = db
    .select({ company: applications.companyName, id: applications.id, title: applications.postingTitle })
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.id, [...applicationIds])))
    .all();

  for (const row of rows) {
    found.set(row.id, { company: row.company, title: row.title });
  }

  return found;
}

/**
 * Every message's attachments in one read.
 * @param db The database to read.
 * @param messageIds The messages on screen.
 * @returns The attachments of each message.
 */
export function attachmentsByMessageOf(db: AppDatabase, messageIds: readonly string[]) {
  if (messageIds.length === 0) {
    return new Map<string, AttachmentRow[]>();
  }

  const rows = db
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, [...messageIds]))
    .orderBy(asc(messageAttachments.id))
    .all();

  return groupBy(rows, (row) => row.messageId);
}

async function threadViewOf(
  personal: PersonalCrypto,
  thread: ThreadRow,
  rows: readonly MessageRow[],
  application: { company: string; title: string } | undefined,
) {
  const latest = rows.at(-1);

  const subject =
    latest === undefined
      ? await personal.openFor(
          thread.userId,
          { column: "subject_enc", rowId: thread.id, table: "mail_threads" },
          thread.subjectEnc,
        )
      : await personal.openFor(
          thread.userId,
          { column: "subject_enc", rowId: latest.id, table: "messages" },
          latest.subjectEnc,
        );

  const from =
    latest === undefined
      ? ""
      : await personal.openFor(
          thread.userId,
          { column: "from_enc", rowId: latest.id, table: "messages" },
          latest.fromEnc,
        );

  const snippet =
    latest === undefined
      ? ""
      : await personal.openFor(
          thread.userId,
          { column: "snippet_enc", rowId: latest.id, table: "messages" },
          latest.snippetEnc,
        );

  return {
    applicationId: thread.applicationId,
    classification: latest?.classification ?? null,
    company: application?.company ?? displayNameOf(from),
    id: thread.id,
    lastMessageAt: thread.lastMessageAt.getTime(),
    needsChecking: rows.some((row) => row.auth !== "pass"),
    snippet,
    subject,
    title: application?.title ?? null,
    unread: rows.some((row) => row.readAt === null && row.direction === "in"),
  } satisfies InboxThreadView;
}

/**
 * The Thread list, with each Thread's messages and employer read in one query
 * each rather than one per Thread.
 * @param input The database, the person's crypto, the signed-in person and their Threads.
 * @returns One view per Thread, in the order given.
 */
export async function threadViewsOf(input: {
  db: AppDatabase;
  personal: PersonalCrypto;
  threads: readonly ThreadRow[];
  userId: string;
}) {
  const { db, personal, threads, userId } = input;

  const messagesFor = messagesByThreadOf(
    db,
    threads.map((thread) => thread.id),
  );

  const applicationIds = threads.flatMap((thread) =>
    thread.applicationId === null ? [] : [thread.applicationId],
  );

  const applicationsFor = applicationsByIdOf(db, userId, applicationIds);

  return Promise.all(
    threads.map(async (thread) =>
      threadViewOf(
        personal,
        thread,
        messagesFor.get(thread.id) ?? [],
        thread.applicationId === null ? undefined : applicationsFor.get(thread.applicationId),
      ),
    ),
  );
}
