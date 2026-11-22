import { Hono } from "hono";
import type { DNSResolver } from "mailauth";

import { Buffer } from "node:buffer";

import { simpleParser } from "mailparser";

import {
  INBOUND_DEAD_LETTER_MAX_BYTES,
  INBOUND_DEAD_LETTER_PATH,
  INBOUND_HEADERS,
  INBOUND_MAX_BYTES,
  INBOUND_PATH,
  isLiveCheckAddress,
  verifyInbound,
} from "../../shared/inbound-mail.ts";
import { parseInboundDeadLetter } from "../../shared/inbound-queue.ts";
import { readBodyCapped } from "../platform/http-body.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { MAIL_INGEST_JOB_KIND } from "../inbox/ingest.ts";
import { inboundAuth } from "../inbox/auth.ts";
import { openCodeWaits } from "../inbox/waits.ts";
import {
  hasOpenLiveCheckMailToken,
  liveCheckCodeFromText,
  liveCheckTokenFromText,
  recordLiveCheckMailInbound,
} from "../live-checks/mail.ts";

export function createInboundRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  personal: PersonalCrypto;
  mailboxes: ReturnType<typeof createMailboxService>;
  resolver: DNSResolver;
  liveCheckAddress: string;
  secret: string | undefined;
}) {
  const { db, clock, objects, personal, mailboxes, resolver, liveCheckAddress, secret } = deps;
  const routes = new Hono();

  async function acceptLiveCheck(body: Uint8Array<ArrayBuffer>, mailFrom: string) {
    const parsed = await simpleParser(Buffer.from(body));
    const subject = parsed.subject ?? "";
    const text = parsed.text ?? "";

    const token = liveCheckTokenFromText(`${subject}\n${text}`);
    const code = liveCheckCodeFromText(`${subject}\n${text}`);

    if (token === null) {
      return;
    }

    if (!hasOpenLiveCheckMailToken(db, token)) {
      return;
    }

    const sender =
      parsed.from?.value.flatMap((entry) => (entry.address ? [entry.address] : []))[0] ?? "";

    const fromDomain = sender.slice(sender.lastIndexOf("@") + 1).toLowerCase();

    const auth =
      fromDomain === ""
        ? "none"
        : await inboundAuth(body, { resolver, fromDomain, sender: mailFrom });

    await objects.put(`recordings/mail/${token}.eml`, body);
    recordLiveCheckMailInbound(db, clock, { auth, code, token });
  }

  routes.post(INBOUND_PATH, async (context) => {
    if (secret === undefined) {
      return context.json({ error: "inbound_not_configured" }, 503);
    }

    const declaredBytes = Number(context.req.header("content-length") ?? "0");

    if (Number.isFinite(declaredBytes) && declaredBytes > INBOUND_MAX_BYTES) {
      return context.body(null, 413);
    }

    const body = await readBodyCapped(context.req.raw, INBOUND_MAX_BYTES);

    if (body === null) {
      return context.body(null, 413);
    }

    const timestamp = context.req.header(INBOUND_HEADERS.timestamp) ?? null;
    const signature = context.req.header(INBOUND_HEADERS.signature) ?? null;
    const rcptTo = context.req.header(INBOUND_HEADERS.rcptTo) ?? null;
    const mailFrom = context.req.header(INBOUND_HEADERS.mailFrom) ?? "";

    const verified = await verifyInbound(secret, {
      timestamp,
      signature,
      rcptTo,
      body,
      nowSeconds: Math.trunc(clock.now() / 1000),
    });

    if (!verified.ok) {
      return context.body(null, 401);
    }

    if (rcptTo === null) {
      return context.body(null, 401);
    }

    if (isLiveCheckAddress(rcptTo, liveCheckAddress.split("@")[1])) {
      await acceptLiveCheck(body, mailFrom);

      return context.body(null, 204);
    }

    const mailbox = await mailboxes.byForwardingAddress(rcptTo);

    if (mailbox === null || mailbox.status === "closed") {
      return context.body(null, 204);
    }

    const objectKey = `mail/${mailbox.userId}/raw/${crypto.randomUUID()}`;

    const sealed = await personal.sealFor(
      mailbox.userId,
      { table: "mail_objects", column: "body", rowId: objectKey },
      Buffer.from(body).toString("base64"),
    );

    await objects.put(objectKey, new TextEncoder().encode(sealed));

    try {
      enqueueJob(
        db,
        clock,
        MAIL_INGEST_JOB_KIND,
        JSON.stringify({
          objectKey,
          mailboxId: mailbox.id,
          rcptTo,
          mailFrom,
          receivedAt: clock.now(),
        }),
      );
    } catch (error) {
      await objects.delete(objectKey);

      throw error;
    }

    return context.body(null, 204);
  });

  routes.post(INBOUND_DEAD_LETTER_PATH, async (context) => {
    if (secret === undefined) {
      return context.json({ error: "inbound_not_configured" }, 503);
    }

    const declaredBytes = Number(context.req.header("content-length") ?? "0");

    if (Number.isFinite(declaredBytes) && declaredBytes > INBOUND_DEAD_LETTER_MAX_BYTES) {
      return context.body(null, 413);
    }

    const body = await readBodyCapped(context.req.raw, INBOUND_DEAD_LETTER_MAX_BYTES);

    if (body === null) {
      return context.body(null, 413);
    }

    const rcptTo = context.req.header(INBOUND_HEADERS.rcptTo) ?? null;

    const verified = await verifyInbound(secret, {
      timestamp: context.req.header(INBOUND_HEADERS.timestamp) ?? null,
      signature: context.req.header(INBOUND_HEADERS.signature) ?? null,
      rcptTo,
      body,
      nowSeconds: Math.trunc(clock.now() / 1000),
    });

    if (!verified.ok || rcptTo === null) {
      return context.body(null, 401);
    }

    const decoded = parseInboundDeadLetter(body);

    if (!decoded.success) {
      return context.body(null, 400);
    }

    if (
      decoded.data.rcptTo !== null &&
      decoded.data.rcptTo.toLowerCase() !== rcptTo.toLowerCase()
    ) {
      return context.body(null, 401);
    }

    const mailbox = await mailboxes.byForwardingAddress(rcptTo);

    raiseAlert(db, clock, "mail.dead_letter", {
      mailboxId: mailbox?.id ?? null,
      reason: decoded.data.reason,
      attempts: decoded.data.attempts,
      status: decoded.data.status,
      reference: decoded.data.reference,
      spillKey: decoded.data.spillKey,
    });

    return context.json({ raised: true }, 202);
  });

  routes.get("/internal/mail/code-waits", async (context) => {
    if (secret === undefined) {
      return context.json({ error: "inbound_not_configured" }, 503);
    }

    const verified = await verifyInbound(secret, {
      timestamp: context.req.header(INBOUND_HEADERS.timestamp) ?? null,
      signature: context.req.header(INBOUND_HEADERS.signature) ?? null,
      rcptTo: context.req.header(INBOUND_HEADERS.rcptTo) ?? null,
      body: new Uint8Array(0),
      nowSeconds: Math.trunc(clock.now() / 1000),
    });

    if (!verified.ok) {
      return context.body(null, 401);
    }

    const address = context.req.header(INBOUND_HEADERS.rcptTo);

    if (address === undefined) {
      return context.body(null, 401);
    }

    const mailbox = await mailboxes.byForwardingAddress(address);

    if (mailbox === null) {
      return context.json({ error: "not found" }, 404);
    }

    const waits = openCodeWaits(db, clock, mailbox.id).map((wait) => ({
      id: wait.id,
      mailboxId: wait.mailboxId,
      attemptId: wait.attemptId,
      startedAt: wait.startedAt,
      expiresAt: wait.expiresAt,
    }));

    return context.json({ waits });
  });

  return routes;
}
