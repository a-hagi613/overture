import { Buffer } from "node:buffer";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { ZipEntry } from "./zip.ts";

import {
  applicationAnswers,
  applicationEvents,
  applicationSnapshots,
  applications,
  calendarCustomEvents,
  facts,
  mailThreads,
  mailboxes,
  messageAttachments,
  messages,
  profiles,
  resumes,
  skipCompanies,
  supportTickets,
  targets,
  users,
} from "../platform/db/schema.ts";
import { copy } from "../../shared/copy.ts";
import { SCREENSHOT_PREFIX } from "../applications/screenshots.ts";

const PAGE_SIZE = 10;
const MESSAGE_PAGE_SIZE = 1;

const jsonValueSchema = z.json();

export interface ExportArchiveDeps {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  personal: PersonalCrypto;
  mailDomain: string;
}

function iso(value: Date | number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function parsed(value: string) {
  let decoded: unknown;

  try {
    decoded = JSON.parse(value);
  } catch {
    return value;
  }

  const result = jsonValueSchema.safeParse(decoded);

  return result.success ? result.data : value;
}

function textEntry(name: string, body: Iterable<string> | AsyncIterable<string>) {
  return {
    modifiedAt: new Date(),
    name,
    read: async function* read() {
      await Promise.resolve();

      for await (const part of body) {
        yield new Uint8Array(new TextEncoder().encode(part));
      }
    },
  } satisfies ZipEntry;
}

function pagesOf<T>(
  pageSize: number,
  pageOf: (after: string | null) => T[],
  keyOf: (row: T) => string,
) {
  async function* iterate() {
    await Promise.resolve();

    let cursor: string | null = null;

    for (;;) {
      const rows = pageOf(cursor);

      if (rows.length === 0) {
        return;
      }

      yield rows;

      if (rows.length < pageSize) {
        return;
      }

      const last = rows.at(-1);

      if (last === undefined) {
        return;
      }

      cursor = keyOf(last);
    }
  }

  return { iterate };
}

async function* serializePage<T>(
  pages: AsyncGenerator<T[]>,
  encode: (page: T[]) => Promise<string[]>,
) {
  const next = await pages.next();

  if (next.done === true) {
    return true;
  }

  const lines = await encode(next.value);

  yield* lines;

  return false;
}

async function* serializePages<T>(
  pages: AsyncGenerator<T[]>,
  encode: (page: T[]) => Promise<string[]>,
) {
  await Promise.resolve();

  for (;;) {
    const done = yield* serializePage(pages, encode);

    if (done) {
      return;
    }
  }
}

async function* jsonArray(rows: Iterable<string> | AsyncIterable<string>) {
  let first = true;

  for await (const row of rows) {
    yield `${first ? "[\n  " : ",\n  "}${row}`;
    first = false;
  }

  yield first ? "[]" : "\n]";
}

function bytesOfBase64(value: string) {
  const buffer = Buffer.from(value, "base64");
  const bytes = new Uint8Array(buffer.byteLength);

  bytes.set(buffer);

  return bytes;
}

function extensionOf(mime: string) {
  switch (mime.toLowerCase()) {
    case "application/pdf": {
      return ".pdf";
    }

    case "image/png": {
      return ".png";
    }

    case "image/jpeg": {
      return ".jpg";
    }

    case "text/calendar": {
      return ".ics";
    }

    case "text/plain": {
      return ".txt";
    }

    default: {
      return ".bin";
    }
  }
}

const resumeScope = (resumeId: string, column: string) => ({
  column,
  rowId: resumeId,
  table: "resumes",
});

const mailObjectScope = (userId: string, objectKey: string) => ({
  column: "body",
  rowId: objectKey,
  table: "mail_objects",
  userId,
});

const messageScope = (messageId: string, column: string) => ({
  column,
  rowId: messageId,
  table: "messages",
});

async function* screenshotsUnder(objects: ObjectStore, userId: string) {
  for await (const key of objects.list(`${SCREENSHOT_PREFIX}${userId}/`)) {
    yield {
      modifiedAt: new Date(),
      name: key,
      read: async function* read() {
        const stream = await objects.getStream(key);

        if (stream === null) {
          return;
        }

        for await (const chunk of stream) {
          yield chunk;
        }
      },
    } satisfies ZipEntry;
  }
}

/**
 * Every file in one user's export, generated as the zip is written. Each table
 * is read in small pages and the rows of one page are opened together, so the
 * job's memory does not grow with the mailbox.
 * @param deps The database, clock, object store, crypto and mail domain.
 * @param userId The one user whose data is exported.
 * @yields {ZipEntry} The archive's next file.
 */
export async function* exportEntries(deps: ExportArchiveDeps, userId: string) {
  const { db, clock, objects, personal, mailDomain } = deps;
  const now = clock.now();
  const attachmentFiles: ZipEntry[] = [];
  const resumeFiles: ZipEntry[] = [];

  const user = db.select().from(users).where(eq(users.id, userId)).get();

  if (user === undefined) {
    throw new Error("The user for this export no longer exists.");
  }

  const profile = db.select().from(profiles).where(eq(profiles.userId, userId)).get();
  const target = db.select().from(targets).where(eq(targets.userId, userId)).get();
  const mailbox = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

  const skips = db
    .select()
    .from(skipCompanies)
    .where(eq(skipCompanies.userId, userId))
    .orderBy(asc(skipCompanies.nameNorm))
    .all();

  yield textEntry(
    "profile.json",
    (function* profileDocument() {
      yield JSON.stringify(
        {
          exportedAt: new Date(now).toISOString(),
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            role: user.role,
            createdAt: iso(user.createdAt),
          },
          profile:
            profile === undefined
              ? null
              : {
                  running: profile.running,
                  pauseReason: profile.pauseReason,
                  languages: parsed(profile.languages),
                  timezone: profile.timezone,
                  onboardedAt: iso(profile.onboardedAt),
                  consentVersion: profile.consentVersion,
                  consentAt: iso(profile.consentAt),
                  createdAt: iso(profile.createdAt),
                },
          mailbox:
            mailbox === undefined
              ? null
              : { address: `${mailbox.localPart}@${mailDomain}`, status: mailbox.status },
          targets:
            target === undefined
              ? null
              : {
                  roles: parsed(target.roles),
                  seniorities: parsed(target.seniorities),
                  workplaces: parsed(target.workplaces),
                  locations: parsed(target.locations),
                  employmentTypes: parsed(target.employmentTypes),
                  salaryFloorMinor: target.salaryFloorMinor,
                  salaryCurrency: target.salaryCurrency,
                  salaryPeriod: target.salaryPeriod,
                },
          skipCompanies: skips.map((row) => ({
            name: row.name,
            domain: row.domain,
            reason: row.reason,
            createdAt: iso(row.createdAt),
          })),
        },
        null,
        2,
      );
    })(),
  );

  yield textEntry(
    "facts.json",
    (async function* factsDocument() {
      const rows = db
        .select()
        .from(facts)
        .where(eq(facts.userId, userId))
        .orderBy(asc(facts.key), asc(facts.scope))
        .all();

      const serialized = await Promise.all(
        rows.map(async (row) =>
          JSON.stringify({
            key: row.key,
            scope: row.scope,
            value: await personal.openFor(
              userId,
              { column: "value_enc", rowId: row.id, table: "facts" },
              row.valueEnc,
            ),
            source: row.source,
            confirmed: row.confirmed,
            revision: row.revision,
            updatedAt: iso(row.updatedAt),
          }),
        ),
      );

      yield* jsonArray(serialized);
    })(),
  );

  yield textEntry(
    "calendar-events.json",
    (async function* calendarEventsDocument() {
      const rows = db
        .select()
        .from(calendarCustomEvents)
        .where(eq(calendarCustomEvents.userId, userId))
        .orderBy(asc(calendarCustomEvents.dayKey), asc(calendarCustomEvents.id))
        .all();

      yield* jsonArray(
        rows.map((row) =>
          JSON.stringify({
            id: row.id,
            dayKey: row.dayKey,
            kind: row.kind,
            title: row.title,
            company: row.company,
            time: row.time,
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          }),
        ),
      );
    })(),
  );

  yield textEntry(
    "support-tickets.json",
    (async function* supportTicketsDocument() {
      const rows = db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.userId, userId))
        .orderBy(asc(supportTickets.createdAt), asc(supportTickets.id))
        .all();

      yield* jsonArray(
        await Promise.all(
          rows.map(async (row) =>
            JSON.stringify({
              id: row.id,
              referenceId: row.referenceId,
              category: row.category,
              subject: row.subject,
              message: await personal.openFor(
                userId,
                { column: "message_enc", rowId: row.id, table: "support_tickets" },
                row.messageEnc,
              ),
              status: row.status,
              userId: row.userId,
              createdAt: iso(row.createdAt),
              updatedAt: iso(row.updatedAt),
              resolvedAt: iso(row.resolvedAt),
            }),
          ),
        ),
      );
    })(),
  );

  yield textEntry(
    "applications.json",
    (async function* applicationsDocument() {
      const pages = pagesOf(
        PAGE_SIZE,
        (after) =>
          db
            .select()
            .from(applications)
            .where(
              after === null
                ? eq(applications.userId, userId)
                : and(eq(applications.userId, userId), gt(applications.id, after)),
            )
            .orderBy(asc(applications.id))
            .limit(PAGE_SIZE)
            .all(),
        (row) => row.id,
      );

      yield* jsonArray(
        serializePages(pages.iterate(), async (page) =>
          Promise.all(
            page.map(async (row) => {
              const events = db
                .select()
                .from(applicationEvents)
                .where(eq(applicationEvents.applicationId, row.id))
                .orderBy(asc(applicationEvents.at), asc(applicationEvents.id))
                .all();

              const answers = db
                .select()
                .from(applicationAnswers)
                .where(eq(applicationAnswers.applicationId, row.id))
                .orderBy(asc(applicationAnswers.createdAt))
                .all();

              const answerRows = await Promise.all(
                answers.map(async (answer) => ({
                  kind: answer.kind,
                  sentences: parsed(
                    await personal.openFor(
                      userId,
                      { column: "sentences_enc", rowId: answer.id, table: "application_answers" },
                      answer.sentencesEnc,
                    ),
                  ),
                  wordCount: answer.wordCount,
                  createdAt: iso(answer.createdAt),
                  updatedAt: iso(answer.updatedAt),
                })),
              );

              return JSON.stringify({
                id: row.id,
                company: row.companyName,
                title: row.postingTitle,
                postingUrl: row.postingUrl,
                origin: row.origin,
                status: row.status,
                statusReason: row.statusReason,
                stage: row.stage,
                stageLocked: row.stageLocked,
                attempts: row.attempts,
                createdAt: iso(row.createdAt),
                updatedAt: iso(row.updatedAt),
                readyAt: iso(row.readyAt),
                approvedAt: iso(row.approvedAt),
                sentAt: iso(row.sentAt),
                closedReason: row.closedReason,
                events: events.map((event) => ({
                  at: event.at,
                  kind: event.kind,
                  from: event.fromValue,
                  to: event.toValue,
                  source: event.source,
                  detail: event.detail === null ? null : parsed(event.detail),
                })),
                answers: answerRows,
              });
            }),
          ),
        ),
      );
    })(),
  );

  yield textEntry(
    "snapshots.json",
    (async function* snapshotsDocument() {
      const pages = pagesOf(
        PAGE_SIZE,
        (after) =>
          db
            .select()
            .from(applicationSnapshots)
            .where(
              after === null
                ? eq(applicationSnapshots.userId, userId)
                : and(
                    eq(applicationSnapshots.userId, userId),
                    gt(applicationSnapshots.applicationId, after),
                  ),
            )
            .orderBy(asc(applicationSnapshots.applicationId))
            .limit(PAGE_SIZE)
            .all(),
        (row) => row.applicationId,
      );

      yield* jsonArray(
        serializePages(pages.iterate(), async (page) =>
          Promise.all(
            page.map(async (row) =>
              JSON.stringify({
                applicationId: row.applicationId,
                postingUrl: row.postingUrl,
                postingTitle: row.postingTitle,
                answers: parsed(
                  await personal.openFor(
                    userId,
                    {
                      column: "answers_enc",
                      rowId: row.applicationId,
                      table: "application_snapshots",
                    },
                    row.answersEnc,
                  ),
                ),
                coverLetter:
                  row.coverLetterEnc === null
                    ? null
                    : parsed(
                        await personal.openFor(
                          userId,
                          {
                            column: "cover_letter_enc",
                            rowId: row.applicationId,
                            table: "application_snapshots",
                          },
                          row.coverLetterEnc,
                        ),
                      ),
                resumeSha256: row.resumeSha256,
                consentVersion: row.consentVersion,
                approvedAt: row.approvedAt,
                approvedPlanSha256: row.approvedPlanSha256,
                provider: row.provider,
                submittedAt: row.submittedAt,
                confirmedBy: row.confirmedBy,
                costMicros: row.costMicros,
              }),
            ),
          ),
        ),
      );
    })(),
  );

  yield textEntry(
    "messages.json",
    (async function* messagesDocument() {
      const pages = pagesOf(
        MESSAGE_PAGE_SIZE,
        (after) =>
          db
            .select()
            .from(mailThreads)
            .where(
              after === null
                ? eq(mailThreads.userId, userId)
                : and(eq(mailThreads.userId, userId), gt(mailThreads.id, after)),
            )
            .orderBy(asc(mailThreads.id))
            .limit(MESSAGE_PAGE_SIZE)
            .all(),
        (row) => row.id,
      );

      yield* jsonArray(
        serializePages(pages.iterate(), async (page) =>
          Promise.all(
            page.map(async (thread) => {
              const messageRows = db
                .select()
                .from(messages)
                .where(eq(messages.threadId, thread.id))
                .orderBy(asc(messages.createdAt), asc(messages.id))
                .all();

              const threadMessages = await Promise.all(
                messageRows.map(async (message) => {
                  const attachments = db
                    .select()
                    .from(messageAttachments)
                    .where(eq(messageAttachments.messageId, message.id))
                    .orderBy(asc(messageAttachments.id))
                    .all();

                  const attachmentRows = await Promise.all(
                    attachments.map(async (attachment) => {
                      const filename = await personal.openFor(
                        userId,
                        {
                          column: "filename_enc",
                          rowId: attachment.id,
                          table: "message_attachments",
                        },
                        attachment.filenameEnc,
                      );

                      const file = `files/attachments/${attachment.id}${extensionOf(attachment.mime)}`;

                      attachmentFiles.push({
                        modifiedAt: new Date(now),
                        name: file,
                        read: () =>
                          objectEntry(objects, personal, userId, attachment.objectKey, (key) =>
                            mailObjectScope(userId, key),
                          ),
                      });

                      return {
                        filename,
                        mime: attachment.mime,
                        bytes: attachment.bytes,
                        file,
                      };
                    }),
                  );

                  return {
                    id: message.id,
                    direction: message.direction,
                    rfcMessageId: message.rfcMessageId,
                    inReplyTo: message.inReplyTo,
                    senderDomain: message.senderDomain,
                    auth: message.auth,
                    classification: message.classification,
                    from: await personal.openFor(
                      userId,
                      messageScope(message.id, "from_enc"),
                      message.fromEnc,
                    ),
                    to: await personal.openFor(
                      userId,
                      messageScope(message.id, "to_enc"),
                      message.toEnc,
                    ),
                    subject: await personal.openFor(
                      userId,
                      messageScope(message.id, "subject_enc"),
                      message.subjectEnc,
                    ),
                    text: await personal.openFor(
                      userId,
                      messageScope(message.id, "text_enc"),
                      message.textEnc,
                    ),
                    snippet: await personal.openFor(
                      userId,
                      messageScope(message.id, "snippet_enc"),
                      message.snippetEnc,
                    ),
                    createdAt: iso(message.createdAt),
                    readAt: iso(message.readAt),
                    attachments: attachmentRows,
                  };
                }),
              );

              return JSON.stringify({
                id: thread.id,
                applicationId: thread.applicationId,
                subject: await personal.openFor(
                  userId,
                  { column: "subject_enc", rowId: thread.id, table: "mail_threads" },
                  thread.subjectEnc,
                ),
                employerStarted: thread.employerStarted,
                lastMessageAt: iso(thread.lastMessageAt),
                messages: threadMessages,
              });
            }),
          ),
        ),
      );
    })(),
  );

  yield textEntry(
    "resumes.json",
    (async function* resumesDocument() {
      const pages = pagesOf(
        PAGE_SIZE,
        (after) =>
          db
            .select()
            .from(resumes)
            .where(
              after === null
                ? eq(resumes.userId, userId)
                : and(eq(resumes.userId, userId), gt(resumes.id, after)),
            )
            .orderBy(asc(resumes.id))
            .limit(PAGE_SIZE)
            .all(),
        (row) => row.id,
      );

      yield* jsonArray(
        serializePages(pages.iterate(), async (page) =>
          Promise.all(
            page.map(async (row) => {
              const filename = await personal.openFor(
                userId,
                resumeScope(row.id, "filename_enc"),
                row.filenameEnc,
              );

              const file = `files/resumes/${row.id}.pdf`;

              resumeFiles.push({
                modifiedAt: new Date(now),
                name: file,
                read: () =>
                  objectEntry(objects, personal, userId, row.objectKey, () => ({
                    ...resumeScope(row.id, "bytes"),
                    userId,
                  })),
              });

              return JSON.stringify({
                id: row.id,
                filename,
                file,
                sha256: row.sha256,
                bytes: row.bytes,
                pages: row.pages,
                isCurrent: row.isCurrent,
                uploadedAt: iso(row.uploadedAt),
                text: await personal.openFor(userId, resumeScope(row.id, "text_enc"), row.textEnc),
              });
            }),
          ),
        ),
      );
    })(),
  );

  yield textEntry(
    "README.txt",
    (function* readme() {
      yield copy.settings.exportPage.readme(user.email, new Date(now).toISOString());
    })(),
  );

  for (const entry of resumeFiles) {
    yield entry;
  }

  for (const entry of attachmentFiles) {
    yield entry;
  }

  yield* screenshotsUnder(objects, userId);
}

async function* objectEntry(
  objects: ObjectStore,
  personal: PersonalCrypto,
  userId: string,
  objectKey: string,
  scopeOf: (key: string) => {
    table: string;
    column: string;
    rowId: string;
    userId?: string;
  },
) {
  const stored = await objects.get(objectKey);

  if (stored === null) {
    throw new Error(`The export is missing an object (${objectKey}).`);
  }

  const sealed = new TextDecoder().decode(stored);

  yield bytesOfBase64(await personal.openFor(userId, scopeOf(objectKey), sealed));
}
