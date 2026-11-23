import { and, asc, desc, eq, exists, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { openOrNull } from "../profile/personal-crypto.ts";

import { applications, mailThreads, messageAttachments, messages } from "../platform/db/schema.ts";

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

export interface InboxThreadCounts {
  all: number;
  needsChecking: number;
  unread: number;
}

export interface InboxThreadPage {
  counts: InboxThreadCounts;
  nextCursor: number | null;
  nextCursorId: string | null;
  threads: InboxThreadView[];
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
 * How many Threads hold at least one unread inbound Message. It mirrors the
 * `unread` flag of {@link threadViewsOf}, counting a Thread once however many
 * unread Messages it holds, so the nav badge and the Inbox list agree.
 * @param db The database to read.
 * @param userId The person whose Threads to count.
 * @returns The number of Threads with an unread inbound Message.
 */
export function unreadThreadCountOf(db: AppDatabase, userId: string) {
  return threadCountsOf(db, userId).unread;
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
    .select({
      company: applications.companyName,
      id: applications.id,
      title: applications.postingTitle,
    })
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
    (latest === undefined
      ? await openOrNull({
          personal,
          scope: { column: "subject_enc", rowId: thread.id, table: "mail_threads" },
          sealed: thread.subjectEnc,
          userId: thread.userId,
        })
      : await openOrNull({
          personal,
          scope: { column: "subject_enc", rowId: latest.id, table: "messages" },
          sealed: latest.subjectEnc,
          userId: thread.userId,
        })) ?? "";

  const from =
    latest === undefined
      ? ""
      : ((await openOrNull({
          personal,
          scope: { column: "from_enc", rowId: latest.id, table: "messages" },
          sealed: latest.fromEnc,
          userId: thread.userId,
        })) ?? "");

  const snippet =
    latest === undefined
      ? ""
      : ((await openOrNull({
          personal,
          scope: { column: "snippet_enc", rowId: latest.id, table: "messages" },
          sealed: latest.snippetEnc,
          userId: thread.userId,
        })) ?? "");

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

/**
 * The Inbox counts for every Thread a person has, in one SQL statement and without opening a message. Each predicate
 * mirrors `threadViewOf` exactly: a Thread needs checking when any of its messages failed authentication, and is
 * unread when any incoming message has no read time.
 * @param db The database to read.
 * @param userId The signed-in person.
 * @returns How many Threads there are in total, waiting on a check, and unread.
 */
export function threadCountsOf(db: AppDatabase, userId: string) {
  const needsChecking = exists(
    db
      .select({ found: sql`1` })
      .from(messages)
      .where(and(eq(messages.threadId, mailThreads.id), sql`${messages.auth} <> 'pass'`)),
  );

  const unread = exists(
    db
      .select({ found: sql`1` })
      .from(messages)
      .where(
        and(
          eq(messages.threadId, mailThreads.id),
          eq(messages.direction, "in"),
          isNull(messages.readAt),
        ),
      ),
  );

  const row = db
    .select({
      all: sql<number>`count(*)`,
      needsChecking: sql<number>`coalesce(sum(${needsChecking}), 0)`,
      unread: sql<number>`coalesce(sum(${unread}), 0)`,
    })
    .from(mailThreads)
    .where(eq(mailThreads.userId, userId))
    .get();

  const counts: InboxThreadCounts = {
    all: row?.all ?? 0,
    needsChecking: row?.needsChecking ?? 0,
    unread: row?.unread ?? 0,
  };

  return counts;
}

function cursorBefore(before: number, beforeId: string | undefined) {
  const at = new Date(before);
  const older = lt(mailThreads.lastMessageAt, at);

  if (beforeId === undefined) {
    return older;
  }

  return or(older, and(eq(mailThreads.lastMessageAt, at), lt(mailThreads.id, beforeId)));
}

/**
 * One page of a person's Threads, newest first, with the accurate counts over every Thread they have. The cursor is
 * `(lastMessageAt, id)`: two Threads can share a second, so the id breaks the tie and a page boundary never skips or
 * repeats one.
 * @param input The database, the person, the page size and the cursor (both null for the first page).
 * @returns The Threads on this page, the counts over all Threads, and the cursor for the next page or null.
 */
export async function threadPageOf(input: {
  before: number | null;
  beforeId: string | null;
  db: AppDatabase;
  limit: number;
  personal: PersonalCrypto;
  userId: string;
}) {
  const { before, beforeId, db, limit, personal, userId } = input;

  const cursor = before === null ? undefined : cursorBefore(before, beforeId ?? undefined);

  const rows = db
    .select()
    .from(mailThreads)
    .where(
      cursor === undefined
        ? eq(mailThreads.userId, userId)
        : and(eq(mailThreads.userId, userId), cursor),
    )
    .orderBy(desc(mailThreads.lastMessageAt), desc(mailThreads.id))
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit;

  const result: InboxThreadPage = {
    counts: threadCountsOf(db, userId),
    nextCursor: hasMore && last !== undefined ? last.lastMessageAt.getTime() : null,
    nextCursorId: hasMore && last !== undefined ? last.id : null,
    threads: await threadViewsOf({ db, personal, threads: page, userId }),
  };

  return result;
}
