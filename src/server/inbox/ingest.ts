import type { DNSResolver } from "mailauth";
import type { AddressObject } from "mailparser";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { createMailboxService } from "./mailboxes.ts";

import { Buffer } from "node:buffer";

import { and, desc, eq, inArray } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { z } from "zod";

import { atsForMailDomain, isAtsMailDomain } from "../../shared/ats-mail-domains.ts";
import { mailboxes, mailThreads, messageAttachments, messages } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { inboundAuth } from "./auth.ts";
import { classifyMail, codeFromText } from "./codes.ts";
import { resolveOpenWaitForMessage } from "./waits.ts";

export const MAIL_INGEST_JOB_KIND = "mail.ingest";
export const SNIPPET_LENGTH = 200;

const ingestPayloadSchema = z.object({
  objectKey: z.string().min(1),
  mailboxId: z.string().min(1),
  rcptTo: z.string().min(1),
  mailFrom: z.string(),
  receivedAt: z.number().int(),
});

function addressText(value: AddressObject | AddressObject[] | undefined) {
  if (value === undefined) {
    return "";
  }

  return Array.isArray(value) ? value.map((entry) => entry.text).join(", ") : value.text;
}

function senderDomainOf(from: AddressObject | undefined) {
  const address = from?.value.flatMap((entry) => (entry.address ? [entry.address] : []))[0];

  if (address === undefined) {
    return "";
  }

  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

function snippetOf(text: string) {
  return text.replaceAll(/\s+/gu, " ").trim().slice(0, SNIPPET_LENGTH);
}

function replyChain(inReplyTo: string | undefined, references: string | string[] | undefined) {
  let fromReferences: string[] = [];

  if (Array.isArray(references)) {
    fromReferences = references;
  } else if (references !== undefined) {
    fromReferences = [references];
  }

  return [inReplyTo, ...fromReferences].flatMap((value) => (value === undefined ? [] : [value]));
}

export function createMailIngest(deps: {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  personal: PersonalCrypto;
  resolver: DNSResolver;
  mailboxes: ReturnType<typeof createMailboxService>;
  onAuthenticatedMessage?: (input: { userId: string; messageId: string }) => Promise<void>;
  onStoredMessage?: (input: { userId: string; messageId: string }) => Promise<void>;
}) {
  const { db, clock, objects, personal, resolver, onAuthenticatedMessage, onStoredMessage } = deps;
  const { mailboxes: mailboxService } = deps;

  async function sealObject(userId: string, key: string, bytes: Uint8Array<ArrayBuffer>) {
    const sealed = await personal.sealFor(
      userId,
      { table: "mail_objects", column: "body", rowId: key },
      Buffer.from(bytes).toString("base64"),
    );

    await objects.put(key, new TextEncoder().encode(sealed));

    return key;
  }

  async function run(payload: string) {
    const job = ingestPayloadSchema.parse(JSON.parse(payload));
    const mailbox = db.select().from(mailboxes).where(eq(mailboxes.id, job.mailboxId)).get();

    if (mailbox === undefined || mailbox.status === "closed") {
      await objects.delete(job.objectKey);

      return;
    }

    const stored = await objects.get(job.objectKey);

    if (stored === null) {
      throw new Error(`Raw message object ${job.objectKey} is missing.`);
    }

    const sealed = new TextDecoder().decode(stored);

    const raw = new Uint8Array(
      Buffer.from(
        await personal.openFor(
          mailbox.userId,
          { table: "mail_objects", column: "body", rowId: job.objectKey },
          sealed,
        ),
        "base64",
      ),
    );

    const parsed = await simpleParser(Buffer.from(raw));
    const senderDomain = senderDomainOf(parsed.from);

    const auth =
      senderDomain === ""
        ? "none"
        : await inboundAuth(raw, { resolver, fromDomain: senderDomain, sender: job.mailFrom });

    const subject = parsed.subject ?? "";
    const text = parsed.text ?? "";
    const fromText = addressText(parsed.from);
    const toText = addressText(parsed.to);
    const messageId = parsed.messageId ?? `<${crypto.randomUUID()}@inbound.overture>`;

    const duplicate = db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.mailboxId, mailbox.id), eq(messages.rfcMessageId, messageId)))
      .get();

    if (duplicate !== undefined) {
      await objects.delete(job.objectKey);

      return;
    }

    const chain = replyChain(parsed.inReplyTo, parsed.references);

    const parentThread =
      chain.length === 0
        ? undefined
        : db
            .select({ threadId: messages.threadId })
            .from(messages)
            .where(and(eq(messages.mailboxId, mailbox.id), inArray(messages.rfcMessageId, chain)))
            .orderBy(desc(messages.createdAt))
            .get();

    const threadId = parentThread?.threadId ?? crypto.randomUUID();
    const id = crypto.randomUUID();

    const threadSubjectEnc = await personal.sealFor(
      mailbox.userId,
      { table: "mail_threads", column: "subject_enc", rowId: threadId },
      subject,
    );

    const fromEnc = await personal.sealFor(
      mailbox.userId,
      { table: "messages", column: "from_enc", rowId: id },
      fromText,
    );

    const toEnc = await personal.sealFor(
      mailbox.userId,
      { table: "messages", column: "to_enc", rowId: id },
      toText,
    );

    const subjectEnc = await personal.sealFor(
      mailbox.userId,
      { table: "messages", column: "subject_enc", rowId: id },
      subject,
    );

    const textEnc = await personal.sealFor(
      mailbox.userId,
      { table: "messages", column: "text_enc", rowId: id },
      text,
    );

    const snippetEnc = await personal.sealFor(
      mailbox.userId,
      { table: "messages", column: "snippet_enc", rowId: id },
      snippetOf(text),
    );

    const html = parsed.html === undefined || parsed.html === false ? "" : parsed.html;

    const htmlObjectKey =
      html === ""
        ? null
        : await sealObject(
            mailbox.userId,
            `mail/${mailbox.userId}/html/${crypto.randomUUID()}`,
            new TextEncoder().encode(html),
          );

    const attachmentRows = await Promise.all(
      parsed.attachments.map(async (attachment) => {
        const attachmentId = crypto.randomUUID();

        const objectKey = await sealObject(
          mailbox.userId,
          `mail/${mailbox.userId}/attachments/${attachmentId}`,
          new Uint8Array(attachment.content),
        );

        const filenameEnc = await personal.sealFor(
          mailbox.userId,
          { table: "message_attachments", column: "filename_enc", rowId: attachmentId },
          attachment.filename ?? "",
        );

        return {
          id: attachmentId,
          messageId: id,
          filenameEnc,
          mime: attachment.contentType,
          bytes: attachment.content.byteLength,
          objectKey,
        };
      }),
    );

    const code = codeFromText(`${subject}\n${text}`);

    const classification =
      code === null
        ? classifyMail(`${subject}\n${text}`, { ats: atsForMailDomain(senderDomain) })
        : "code";

    const createdAt = new Date(clock.now());

    await db.transaction(async (tx) => {
      if (parentThread === undefined) {
        await tx.insert(mailThreads).values({
          id: threadId,
          userId: mailbox.userId,
          applicationId: null,
          subjectEnc: threadSubjectEnc,
          employerStarted: true,
          lastMessageAt: createdAt,
        });
      } else {
        await tx
          .update(mailThreads)
          .set({ lastMessageAt: createdAt })
          .where(eq(mailThreads.id, threadId));
      }

      await tx.insert(messages).values({
        id,
        threadId,
        userId: mailbox.userId,
        mailboxId: mailbox.id,
        direction: "in",
        rfcMessageId: messageId,
        inReplyTo: parsed.inReplyTo ?? null,
        senderDomain,
        auth,
        fromEnc,
        toEnc,
        subjectEnc,
        textEnc,
        htmlObjectKey,
        snippetEnc,
        classification,
        createdAt,
      });

      if (attachmentRows.length > 0) {
        await tx.insert(messageAttachments).values(attachmentRows);
      }
    });

    await objects.delete(job.objectKey);

    if (isAtsMailDomain(senderDomain)) {
      mailboxService.markFirstForwarded(mailbox.id, clock.now());
    }

    publishEvent(
      db,
      clock,
      "message.received",
      JSON.stringify({
        messageId: id,
        threadId,
        mailboxId: mailbox.id,
        auth,
        classification,
      }),
      mailbox.userId,
    );

    if (onStoredMessage !== undefined) {
      await onStoredMessage({ messageId: id, userId: mailbox.userId }).catch(() => undefined);
    }

    if (onAuthenticatedMessage !== undefined && auth === "pass") {
      await onAuthenticatedMessage({ messageId: id, userId: mailbox.userId }).catch(
        () => undefined,
      );
    }

    if (
      code !== null &&
      auth === "pass" &&
      mailbox.status === "active" &&
      isAtsMailDomain(senderDomain)
    ) {
      await resolveOpenWaitForMessage(deps, {
        userId: mailbox.userId,
        mailboxId: mailbox.id,
        code,
        messageId: id,
        receivedAt: job.receivedAt,
      });
    }
  }

  return { run };
}
