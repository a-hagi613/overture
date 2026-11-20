import { Hono } from "hono";

import { Buffer } from "node:buffer";

import {
  INBOUND_HEADERS,
  INBOUND_MAX_BYTES,
  INBOUND_PATH,
  verifyInbound,
} from "../../shared/inbound-mail.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";
import { MAIL_INGEST_JOB_KIND } from "../inbox/ingest.ts";
import { openCodeWaits } from "../inbox/waits.ts";

export function createInboundRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  personal: PersonalCrypto;
  mailboxes: ReturnType<typeof createMailboxService>;
  secret: string | undefined;
}) {
  const { db, clock, objects, personal, mailboxes, secret } = deps;
  const routes = new Hono();

  routes.post(INBOUND_PATH, async (context) => {
    if (secret === undefined) {
      return context.json({ error: "inbound_not_configured" }, 503);
    }

    const declaredBytes = Number(context.req.header("content-length") ?? "0");

    if (Number.isFinite(declaredBytes) && declaredBytes > INBOUND_MAX_BYTES) {
      return context.body(null, 413);
    }

    const body = new Uint8Array(await context.req.arrayBuffer());

    if (body.byteLength > INBOUND_MAX_BYTES) {
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
