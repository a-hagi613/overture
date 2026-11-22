import { Buffer } from "node:buffer";

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";

import { readSessionUser } from "../auth/session.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

import { mailThreads, messageAttachments, messages } from "../platform/db/schema.ts";
import { attachmentsByMessageOf, messagesByThreadOf, threadViewsOf } from "../inbox/threads.ts";

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;

function safeMime(mime: string) {
  const base = mime.split(";")[0]?.trim() ?? "";

  return MIME_PATTERN.test(base) ? base : "application/octet-stream";
}

function safeFilename(filename: string) {
  const cleaned = filename
    .replaceAll(/[\p{Cc}"\\]/gu, "")
    .trim()
    .slice(0, 180);

  return cleaned === "" ? "attachment" : cleaned;
}

export function createInboxRoutes(deps: {
  auth: Auth;
  clock: Clock;
  db: AppDatabase;
  objects: ObjectStore;
  personal: PersonalCrypto;
}) {
  const { auth, clock, db, objects, personal } = deps;
  const routes = new Hono();

  async function messageView(
    message: typeof messages.$inferSelect,
    attachments: readonly (typeof messageAttachments.$inferSelect)[],
  ) {
    const [subject, from, text] = await Promise.all([
      personal.openFor(
        message.userId,
        { column: "subject_enc", rowId: message.id, table: "messages" },
        message.subjectEnc,
      ),
      personal.openFor(
        message.userId,
        { column: "from_enc", rowId: message.id, table: "messages" },
        message.fromEnc,
      ),
      personal.openFor(
        message.userId,
        { column: "text_enc", rowId: message.id, table: "messages" },
        message.textEnc,
      ),
    ]);

    const opened = await Promise.all(
      attachments.map(async (attachment) => ({
        bytes: attachment.bytes,
        filename: await personal.openFor(
          message.userId,
          { column: "filename_enc", rowId: attachment.id, table: "message_attachments" },
          attachment.filenameEnc,
        ),
        id: attachment.id,
        mime: attachment.mime,
      })),
    );

    return {
      attachments: opened,
      auth: message.auth,
      classification: message.classification,
      createdAt: message.createdAt.getTime(),
      direction: message.direction,
      from,
      id: message.id,
      readAt: message.readAt?.getTime() ?? null,
      subject,
      text,
    };
  }

  routes.use("/threads/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  routes.get("/threads", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const threads = db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.userId, user.id))
      .orderBy(desc(mailThreads.lastMessageAt))
      .all();

    const rows = await threadViewsOf({ db, personal, threads, userId: user.id });

    return context.json({
      counts: {
        all: rows.length,
        needsChecking: rows.filter((row) => row.needsChecking).length,
        unread: rows.filter((row) => row.unread).length,
      },
      threads: rows,
    });
  });

  routes.get("/threads/:id", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const thread = db
      .select()
      .from(mailThreads)
      .where(and(eq(mailThreads.id, context.req.param("id")), eq(mailThreads.userId, user.id)))
      .get();

    if (thread === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const messagesFor = messagesByThreadOf(db, [thread.id]).get(thread.id) ?? [];

    const attachmentsFor = attachmentsByMessageOf(
      db,
      messagesFor.map((row) => row.id),
    );

    const views = await threadViewsOf({ db, personal, threads: [thread], userId: user.id });

    return context.json({
      messages: await Promise.all(
        messagesFor.map(async (row) => messageView(row, attachmentsFor.get(row.id) ?? [])),
      ),
      thread: views[0] ?? null,
    });
  });

  routes.post("/messages/:id/read", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const row = db
      .select()
      .from(messages)
      .where(and(eq(messages.id, context.req.param("id")), eq(messages.userId, user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    if (row.readAt === null) {
      const readAt = new Date(clock.now());

      await retryWhenBusy(() => {
        db.update(messages).set({ readAt }).where(eq(messages.id, row.id)).run();
      }, "inbox.markRead");

      return context.json({ id: row.id, readAt: readAt.getTime() });
    }

    return context.json({ id: row.id, readAt: row.readAt.getTime() });
  });

  routes.get("/attachments/:id", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const attachment = db
      .select()
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(and(eq(messageAttachments.id, context.req.param("id")), eq(messages.userId, user.id)))
      .get();

    if (attachment === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const stored = await objects.get(attachment.message_attachments.objectKey);

    if (stored === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const base64 = await personal.openFor(
      user.id,
      {
        column: "body",
        rowId: attachment.message_attachments.objectKey,
        table: "mail_objects",
      },
      new TextDecoder().decode(stored),
    );

    const filename = await personal.openFor(
      user.id,
      {
        column: "filename_enc",
        rowId: attachment.message_attachments.id,
        table: "message_attachments",
      },
      attachment.message_attachments.filenameEnc,
    );

    const bytes = new Uint8Array(Buffer.from(base64, "base64"));

    return new Response(bytes, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${safeFilename(filename)}"`,
        "content-type": safeMime(attachment.message_attachments.mime),
        "x-content-type-options": "nosniff",
      },
    });
  });

  return routes;
}
