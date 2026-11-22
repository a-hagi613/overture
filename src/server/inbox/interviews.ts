import { Buffer } from "node:buffer";

import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { ParsedInterviewEvent } from "./ics.ts";

import {
  interviewEvents,
  mailThreads,
  messageAttachments,
  messages,
  profiles,
} from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { parseInterviewCalendar, usableTimeZone } from "./ics.ts";

const CALENDAR_MIMES = new Set(["application/ics", "text/calendar"]);

function isCalendarAttachment(mime: string, filename: string) {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";

  return CALENDAR_MIMES.has(type) || filename.trim().toLowerCase().endsWith(".ics");
}

/**
 * Keeps `interview_events` current from the `text/calendar` attachments of forwarded ATS mail. A higher `SEQUENCE`
 * replaces the row for the same `UID`, an older one is ignored, and `METHOD:CANCEL` or `STATUS:CANCELLED` deletes it.
 * Nothing is read from the mail body. An event with no linked Application is skipped, because the Calendar only shows
 * facts beside a card; a later message for a stored `UID` still reschedules or cancels that row.
 * @param deps The database, clock, object store and crypto the recorder reads through.
 * @returns The recorder the inbound-mail path calls for an authenticated message.
 */
export function createInterviewCalendar(deps: {
  clock: Clock;
  db: AppDatabase;
  objects: ObjectStore;
  personal: PersonalCrypto;
}) {
  const { clock, db, objects, personal } = deps;

  async function attachmentTextOf(userId: string, objectKey: string) {
    const stored = await objects.get(objectKey);

    if (stored === null) {
      return null;
    }

    const sealed = new TextDecoder().decode(stored);

    const base64 = await personal.openFor(
      userId,
      { column: "body", rowId: objectKey, table: "mail_objects" },
      sealed,
    );

    return Buffer.from(base64, "base64").toString("utf8");
  }

  function storedEventsOf(userId: string, uid: string) {
    return db
      .select({
        applicationId: interviewEvents.applicationId,
        sequence: interviewEvents.sequence,
      })
      .from(interviewEvents)
      .where(and(eq(interviewEvents.userId, userId), eq(interviewEvents.uid, uid)))
      .all();
  }

  function writeEvent(input: {
    applicationId: string | null;
    event: ParsedInterviewEvent;
    messageId: string;
    userId: string;
  }) {
    const { event } = input;
    const stored = storedEventsOf(input.userId, event.uid);
    const storedRow = stored.at(0);

    if (event.cancelled) {
      if (storedRow === undefined || storedRow.sequence > event.sequence) {
        return null;
      }

      db.delete(interviewEvents)
        .where(and(eq(interviewEvents.userId, input.userId), eq(interviewEvents.uid, event.uid)))
        .run();

      return storedRow.applicationId;
    }

    const applicationId = storedRow?.applicationId ?? input.applicationId;
    const { startsAt } = event;

    if (
      startsAt === null ||
      applicationId === null ||
      stored.some((row) => row.sequence >= event.sequence)
    ) {
      return null;
    }

    db.transaction((tx) => {
      tx.delete(interviewEvents)
        .where(and(eq(interviewEvents.userId, input.userId), eq(interviewEvents.uid, event.uid)))
        .run();

      tx.insert(interviewEvents)
        .values({
          applicationId,
          createdAt: clock.now(),
          endsAt: event.endsAt,
          id: crypto.randomUUID(),
          messageId: input.messageId,
          sequence: event.sequence,
          source: "ics",
          startsAt,
          tz: event.tz,
          uid: event.uid,
          userId: input.userId,
        })
        .run();
    });

    return applicationId;
  }

  async function recordForMessage(input: { messageId: string; userId: string }) {
    const message = db.select().from(messages).where(eq(messages.id, input.messageId)).get();

    if (message === undefined || message.userId !== input.userId || message.auth !== "pass") {
      return 0;
    }

    const thread = db
      .select({ applicationId: mailThreads.applicationId })
      .from(mailThreads)
      .where(eq(mailThreads.id, message.threadId))
      .get();

    const linkedApplicationId = thread?.applicationId ?? null;

    const profile = db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.userId, input.userId))
      .get();

    const fallbackTimeZone = usableTimeZone(profile?.timezone ?? null);

    const attachments = db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, message.id))
      .all();

    const calendars = await Promise.all(
      attachments.map(async (attachment) => {
        const filename = await personal.openFor(
          input.userId,
          { column: "filename_enc", rowId: attachment.id, table: "message_attachments" },
          attachment.filenameEnc,
        );

        if (!isCalendarAttachment(attachment.mime, filename)) {
          return null;
        }

        return attachmentTextOf(input.userId, attachment.objectKey);
      }),
    );

    let changed = 0;
    let changedApplicationId: string | null = null;

    for (const text of calendars) {
      if (text === null) {
        continue;
      }

      for (const event of parseInterviewCalendar(text, fallbackTimeZone)) {
        const applicationId = writeEvent({
          applicationId: linkedApplicationId,
          event,
          messageId: message.id,
          userId: input.userId,
        });

        if (applicationId !== null) {
          changedApplicationId = applicationId;
          changed += 1;
        }
      }
    }

    if (changed > 0) {
      publishEvent(
        db,
        clock,
        "calendar.updated",
        JSON.stringify({ applicationId: changedApplicationId, messageId: message.id }),
        input.userId,
      );
    }

    return changed;
  }

  return { recordForMessage };
}
