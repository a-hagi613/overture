import { afterEach, describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import type { Clock } from "../platform/ports/clock.ts";

Bun.env.BETTER_AUTH_SECRET ??= "copies-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { masterKeyringFor } = await import("../platform/crypto.ts");

const { openDatabase } = await import("../platform/db/client.ts");

const { migrateDatabase } = await import("../platform/db/migrate.ts");

const { mailDeliveries, mailThreads, messageAttachments, messages, users } =
  await import("../platform/db/schema.ts");

const { createClock } = await import("../platform/ports/clock.ts");

const { createDiskObjectStore } = await import("../platform/ports/object-store.ts");

const { createSinkMailSender, listSinkMail, clearSinkMail, failNextSinkMail, bounceNextSinkMail } =
  await import("../platform/mail/sink.ts");

const { createPersonalCrypto } = await import("../profile/personal-crypto.ts");

const { createInboundCopies } = await import("./copies.ts");

const { createMailDnsResolver } = await import("./dns.ts");

const { createMailIngest } = await import("./ingest.ts");

const { createMailboxService } = await import("./mailboxes.ts");

const MASTER = new Uint8Array(32).fill(7);
const SECRET = "aaaaaaaaaaaaaaaa";
const DOMAIN = "example.test";

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }

  clearSinkMail();
});

function world() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const directory = mkdtempSync(join(tmpdir(), "mail-copies-"));

  scratchDirectories.push(directory);

  const clock: Clock = createClock();
  const objects = createDiskObjectStore(directory);
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const mailboxes = createMailboxService(db, clock, SECRET, DOMAIN);

  const copies = createInboundCopies({
    clock,
    db,
    domains: [DOMAIN],
    mail: createSinkMailSender(clock),
    origin: "https://overture.test",
  });

  const ingest = createMailIngest({
    clock,
    copies,
    db,
    mailboxes,
    objects,
    personal,
    resolver: createMailDnsResolver(undefined),
  });

  function addUser(id: string, email: string, name: string, emailVerified = true) {
    const now = new Date(clock.now());

    db.insert(users)
      .values({
        createdAt: now,
        email,
        emailVerified,
        id,
        name,
        role: "user",
        updatedAt: now,
      })
      .run();
  }

  async function post(input: { raw: Uint8Array<ArrayBuffer>; to: string; reference?: string }) {
    const reference = input.reference ?? crypto.randomUUID();
    const objectKey = `mail/raw/${reference}.eml`;

    const mailbox = await mailboxes.byForwardingAddress(input.to);

    if (mailbox === null) {
      throw new Error("The test address did not resolve.");
    }

    const sealed = await personal.sealFor(
      mailbox.userId,
      { column: "body", rowId: objectKey, table: "mail_objects", userId: mailbox.userId },
      Buffer.from(input.raw).toString("base64"),
    );

    await objects.put(objectKey, new TextEncoder().encode(sealed));

    await ingest.run(
      JSON.stringify({
        mailFrom: "recruiter@northstar.example",
        mailboxId: mailbox.id,
        objectKey,
        rcptTo: input.to,
        receivedAt: clock.now(),
      }),
    );
  }

  function deliveryOf(messageId: string) {
    return db.select().from(mailDeliveries).where(eq(mailDeliveries.messageId, messageId)).get();
  }

  return {
    addUser,
    clock,
    copies,
    db,
    deliveryOf,
    ingest,
    mailboxes,
    objects,
    post,
    sqlite,
  };
}

function mime(input: {
  from?: string;
  messageId?: string | null;
  subject?: string;
  text?: string;
  extraHeaders?: readonly string[];
  attachmentBytes?: number;
}) {
  const headers = [
    `From: ${input.from ?? "Northstar Recruiting <priya@northstar.example>"}`,
    "To: ada.chen.4k@example.test",
    `Subject: ${input.subject ?? "Your application"}`,
    "Date: Wed, 18 Nov 2026 15:04:05 +0000",
  ];

  if (input.messageId !== null) {
    headers.push(`Message-ID: <${input.messageId ?? crypto.randomUUID()}@northstar.example>`);
  }

  headers.push(...(input.extraHeaders ?? []));

  if (input.attachmentBytes === undefined) {
    headers.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="utf-8"');

    return new TextEncoder().encode([...headers, "", input.text ?? "Hello Ada."].join("\r\n"));
  }

  const base64 = Buffer.alloc(input.attachmentBytes, 7).toString("base64");

  return new TextEncoder().encode(
    [
      ...headers,
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="copy-boundary"',
      "",
      "--copy-boundary",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      input.text ?? "Please find the brief attached.",
      "",
      "--copy-boundary",
      'Content-Type: application/pdf; name="brief.pdf"',
      'Content-Disposition: attachment; filename="brief.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      base64,
      "--copy-boundary--",
      "",
    ].join("\r\n"),
  );
}

async function mailboxAddress(worldValue: ReturnType<typeof world>, userId: string) {
  const mailbox = await worldValue.mailboxes.ensureFor(userId);

  return mailbox.applyAddress ?? mailbox.address;
}

describe("the per-user inbound copy", () => {
  test("stores one delivery record with the receipt and sends one copy to that user", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");

    await w.post({
      raw: mime({
        extraHeaders: ["In-Reply-To: <parent@northstar.example>", "X-Campaign: northstar"],
        messageId: "one",
      }),
      to: address,
    });

    const [stored] = w.db.select().from(messages).all();

    if (stored === undefined) {
      throw new Error("The message was not stored.");
    }

    const delivery = w.deliveryOf(stored.id);

    expect(delivery?.status).toBe("sent");
    expect(delivery?.attempts).toBe(1);

    const sent = listSinkMail();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.test");
    expect(sent[0]?.to).not.toBe("owner@example.test");
    expect(sent[0]?.subject).toBe("Your application");
    expect(sent[0]?.body).toContain("Hello Ada.");
    expect(sent[0]?.replyTo).toBe("priya@northstar.example");
    expect(sent[0]?.headers).toEqual({
      "in-reply-to": "<parent@northstar.example>",
      "x-campaign": "northstar",
    });
    expect(sent[0]?.headers).not.toHaveProperty("Date");
    expect(sent[0]?.headers).not.toHaveProperty("Message-ID");

    w.sqlite.close();
  });

  test("user A's mail never reaches user B or a shared owner address", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    w.addUser("user-b", "grace@example.test", "Grace Hopper");

    const a = await mailboxAddress(w, "user-a");
    const b = await mailboxAddress(w, "user-b");

    await w.post({ raw: mime({ messageId: "a-only", text: "MARKER-A-SECRET" }), to: a });

    const sent = listSinkMail();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.test");
    expect(sent.map((mail) => mail.to)).not.toContain("grace@example.test");
    expect(sent.map((mail) => mail.to)).not.toContain("owner@example.test");

    const bMessages = w.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, "user-b"))
      .all();

    expect(bMessages).toHaveLength(0);
    expect(
      w.db.select({ id: messages.id }).from(messages).where(eq(messages.userId, "user-a")).all(),
    ).toHaveLength(1);

    await w.post({ raw: mime({ messageId: "b-only", text: "MARKER-B" }), to: b });

    expect(listSinkMail().map((mail) => mail.to)).toEqual([
      "ada@example.test",
      "grace@example.test",
    ]);
  });

  test("deduplicates a redelivery per mailbox even without a Message-ID", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");
    const raw = mime({ messageId: null, text: "No message id here." });

    await w.post({ raw, to: address });
    await w.post({ raw, to: address });

    expect(w.db.select().from(messages).all()).toHaveLength(1);
    expect(w.db.select().from(mailDeliveries).all()).toHaveLength(1);
    expect(listSinkMail()).toHaveLength(1);
  });

  test("sends to the current verified login email after it changes", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");

    await w.post({ raw: mime({ messageId: "before" }), to: address });

    w.db.update(users).set({ email: "ada.new@example.test" }).where(eq(users.id, "user-a")).run();

    await w.post({ raw: mime({ messageId: "after" }), to: address });

    expect(listSinkMail().map((mail) => mail.to)).toEqual([
      "ada@example.test",
      "ada.new@example.test",
    ]);
  });

  test("an unverified account keeps the message but gets no copy", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen", false);
    const address = await mailboxAddress(w, "user-a");

    await w.post({ raw: mime({ messageId: "unverified" }), to: address });

    const [stored] = w.db.select().from(messages).all();

    expect(stored).toBeDefined();
    expect(stored === undefined ? undefined : w.deliveryOf(stored.id)?.status).toBe("skipped");
    expect(stored === undefined ? undefined : w.deliveryOf(stored.id)?.detail).toBe("unverified");
    expect(listSinkMail()).toHaveLength(0);
  });

  test("a reserved alias never resolves to a person", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");

    expect(await w.mailboxes.byForwardingAddress("support@example.test")).toBeNull();
    expect(await w.mailboxes.byForwardingAddress("mailer-daemon@example.test")).toBeNull();
    expect(await w.mailboxes.byForwardingAddress("ada.chen.4k@example.test")).toBeNull();
  });

  test("a retired alias never resolves again", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");

    const mailbox = await w.mailboxes.ensureFor("user-a");
    const address = mailbox.applyAddress ?? mailbox.address;

    w.mailboxes.retireFor("user-a");

    expect(await w.mailboxes.byForwardingAddress(address)).toBeNull();
  });

  test("an auto-submitted, self-domain or X-Loop message is stored but never copied", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");

    await w.post({
      raw: mime({ extraHeaders: ["Auto-Submitted: auto-replied"], messageId: "auto" }),
      to: address,
    });
    await w.post({
      raw: mime({ from: "Overture <notify@example.test>", messageId: "self" }),
      to: address,
    });
    await w.post({
      raw: mime({ extraHeaders: ["X-Loop: example.test"], messageId: "loop" }),
      to: address,
    });

    expect(w.db.select().from(messages).all()).toHaveLength(3);
    expect(listSinkMail()).toHaveLength(0);

    const details = w.db
      .select({ detail: mailDeliveries.detail, status: mailDeliveries.status })
      .from(mailDeliveries)
      .all();

    expect(details.map((row) => row.detail)).toEqual(["auto_submitted", "self_domain", "x_loop"]);
    expect(details.every((row) => row.status === "skipped")).toBe(true);
  });

  test("an oversize attachment stays in the Inbox and the copy links to it", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");

    await w.post({
      raw: mime({ attachmentBytes: 4 * 1024 * 1024 + 256 * 1024 }),
      to: address,
    });

    const [stored] = w.db.select().from(messages).all();

    if (stored === undefined) {
      throw new Error("The message was not stored.");
    }

    expect(
      w.db
        .select({ id: messageAttachments.id })
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, stored.id))
        .all(),
    ).toHaveLength(1);

    const [sent] = listSinkMail();

    expect(sent?.attachments ?? []).toHaveLength(0);
    expect(sent?.body).toContain("Attachments kept in your Overture Inbox:");
    expect(sent?.body).toContain("brief.pdf");
    expect(sent?.body).toContain("https://overture.test/inbox?message=");
  });

  test("a temporary provider failure retries safely and sends exactly one copy", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");
    const raw = mime({ messageId: "retry" });

    failNextSinkMail(1);

    let retried = false;

    try {
      await w.post({ raw, to: address });
    } catch {
      retried = true;
    }

    expect(retried).toBe(true);

    const [stored] = w.db.select().from(messages).all();

    if (stored === undefined) {
      throw new Error("The message was not stored on the failed copy.");
    }

    expect(w.deliveryOf(stored.id)?.status).toBe("failed");
    expect(w.deliveryOf(stored.id)?.attempts).toBe(1);
    expect(listSinkMail()).toHaveLength(0);

    await w.post({ raw, to: address });

    expect(w.db.select().from(messages).all()).toHaveLength(1);
    expect(w.deliveryOf(stored.id)?.status).toBe("sent");
    expect(w.deliveryOf(stored.id)?.attempts).toBe(2);
    expect(listSinkMail()).toHaveLength(1);
  });

  test("a permanent bounce is recorded and surfaced", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");

    bounceNextSinkMail(1);

    await w.post({ raw: mime({ messageId: "bounce" }), to: address });

    const [stored] = w.db.select().from(messages).all();

    if (stored === undefined) {
      throw new Error("The message was not stored.");
    }

    expect(w.deliveryOf(stored.id)?.status).toBe("bounced");
    expect(w.deliveryOf(stored.id)?.detail).toBe("permanent_bounce");
    expect(listSinkMail()).toHaveLength(1);
  });
});

describe("the delivery record shares the receipt transaction", () => {
  test("rolls the stored message back when the delivery insert fails", async () => {
    const w = world();

    w.addUser("user-a", "ada@example.test", "Ada Chen");
    const address = await mailboxAddress(w, "user-a");

    w.sqlite.run(
      "create trigger reject_delivery before insert on mail_deliveries begin select raise(abort, 'forced delivery failure'); end",
    );

    let failed = false;

    try {
      await w.post({ raw: mime({ messageId: "rollback" }), to: address });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(w.db.select().from(messages).all()).toHaveLength(0);
    expect(w.db.select().from(mailThreads).all()).toHaveLength(0);
    expect(w.db.select().from(mailDeliveries).all()).toHaveLength(0);
    expect(listSinkMail()).toHaveLength(0);

    w.sqlite.close();
  });
});
