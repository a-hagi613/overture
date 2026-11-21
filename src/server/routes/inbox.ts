import { Buffer } from "node:buffer";

import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import {
  applications,
  companies,
  mailThreads,
  messageAttachments,
  messages,
  postings,
} from "../platform/db/schema.ts";

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;

function displayNameOf(from: string) {
  const open = from.indexOf("<");

  if (open === -1) {
    return from.trim();
  }

  const name = from.slice(0, open).trim().replaceAll(/^"|"$/gu, "");

  return name === "" ? from.trim() : name;
}

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

  async function sessionUser(raw: Request) {
    const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

    return result?.user ?? null;
  }

  function applicationOf(userId: string, applicationId: string | null) {
    return applicationId === null
      ? undefined
      : db
          .select({ company: companies.name, title: postings.title })
          .from(applications)
          .innerJoin(companies, eq(companies.id, applications.companyId))
          .innerJoin(postings, eq(postings.id, applications.postingId))
          .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
          .get();
  }

  function messagesOf(threadId: string) {
    return db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))
      .all();
  }

  async function threadView(thread: typeof mailThreads.$inferSelect) {
    const rows = messagesOf(thread.id);
    const latest = rows.at(-1);
    const application = applicationOf(thread.userId, thread.applicationId);

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
    };
  }

  async function messageView(message: typeof messages.$inferSelect) {
    const [subject, from, to, text] = await Promise.all([
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
        { column: "to_enc", rowId: message.id, table: "messages" },
        message.toEnc,
      ),
      personal.openFor(
        message.userId,
        { column: "text_enc", rowId: message.id, table: "messages" },
        message.textEnc,
      ),
    ]);

    const attachments = await Promise.all(
      db
        .select()
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, message.id))
        .all()
        .map(async (attachment) => ({
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
      attachments,
      auth: message.auth,
      classification: message.classification,
      createdAt: message.createdAt.getTime(),
      direction: message.direction,
      from,
      id: message.id,
      readAt: message.readAt?.getTime() ?? null,
      subject,
      text,
      to,
    };
  }

  routes.get("/threads", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const threads = db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.userId, user.id))
      .orderBy(desc(mailThreads.lastMessageAt))
      .all();

    const rows = await Promise.all(threads.map(async (thread) => threadView(thread)));

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
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const thread = db
      .select()
      .from(mailThreads)
      .where(and(eq(mailThreads.id, context.req.param("id")), eq(mailThreads.userId, user.id)))
      .get();

    if (thread === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json({
      messages: await Promise.all(messagesOf(thread.id).map(async (row) => messageView(row))),
      thread: await threadView(thread),
    });
  });

  routes.post("/messages/:id/read", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const row = db
      .select()
      .from(messages)
      .where(and(eq(messages.id, context.req.param("id")), eq(messages.userId, user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    if (row.readAt === null) {
      const readAt = new Date(clock.now());

      db.update(messages).set({ readAt }).where(eq(messages.id, row.id)).run();

      return context.json({ id: row.id, readAt: readAt.getTime() });
    }

    return context.json({ id: row.id, readAt: row.readAt.getTime() });
  });

  routes.get("/attachments/:id", async (context) => {
    const user = await sessionUser(context.req.raw);

    if (user === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const attachment = db
      .select()
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(and(eq(messageAttachments.id, context.req.param("id")), eq(messages.userId, user.id)))
      .get();

    if (attachment === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    const stored = await objects.get(attachment.message_attachments.objectKey);

    if (stored === null) {
      return context.json({ error: "not found" }, 404);
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
        "content-disposition": `attachment; filename="${safeFilename(filename)}"`,
        "content-type": safeMime(attachment.message_attachments.mime),
      },
    });
  });

  return routes;
}
