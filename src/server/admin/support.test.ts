import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { adminAudit, supportTickets, users } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";

Bun.env.BETTER_AUTH_SECRET ??= "admin-support-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "admin-support-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "admin-support-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const {
  adminSupportQuerySchema,
  listAdminSupport,
  openSupportTicketCount,
  replyToSupportTicket,
  updateAdminSupportTicket,
} = await import("./support.ts");

const { clearSinkMail, createSinkMailSender, failNextSinkMail, listSinkMail } =
  await import("../platform/mail/sink.ts");

const NOW = Date.UTC(2026, 10, 23, 9, 30, 0);

const MASTER = new Uint8Array(32).fill(9);

const clock: Clock = { now: () => NOW };

const AUTHOR = {
  email: "ticket-author@example.com",
  id: "person-1",
  name: "Ticket Author",
};

function fresh() {
  const { db } = openCountingDatabase();

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: AUTHOR.email,
      emailVerified: true,
      id: AUTHOR.id,
      name: AUTHOR.name,
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  const personal = createPersonalCrypto(db, MASTER, 1);

  return { db, personal };
}

async function seedTicket(
  db: AppDatabase,
  input: {
    category?: "account" | "billing" | "bug" | "other";
    createdAt: number;
    id: string;
    message: string;
    personal: ReturnType<typeof createPersonalCrypto>;
    referenceId: string;
    status?: "open" | "in_progress" | "resolved" | "closed";
    subject?: string;
  },
) {
  const created = new Date(input.createdAt);

  db.insert(supportTickets)
    .values({
      category: input.category ?? "other",
      createdAt: created,
      id: input.id,
      messageEnc: await input.personal.sealFor(
        AUTHOR.id,
        { column: "message_enc", rowId: input.id, table: "support_tickets" },
        input.message,
      ),
      referenceId: input.referenceId,
      status: input.status ?? "open",
      subject: input.subject ?? "A question",
      updatedAt: created,
      userId: AUTHOR.id,
    })
    .run();
}

function auditRows(db: AppDatabase) {
  return db.select().from(adminAudit).all();
}

describe("the admin support query", () => {
  test("clamps the limit and defaults the status", () => {
    expect(adminSupportQuerySchema.parse({})).toEqual({ limit: 50, status: "all" });
    expect(adminSupportQuerySchema.parse({ limit: "1" }).limit).toBe(1);
    expect(adminSupportQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(adminSupportQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(adminSupportQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(adminSupportQuerySchema.safeParse({ status: "waiting" }).success).toBe(false);
  });
});

describe("the support queue read", () => {
  test("lists newest-first with the opened message, the author and the open count", async () => {
    const { db, personal } = fresh();

    await seedTicket(db, {
      createdAt: NOW - 60_000,
      id: "ticket-old",
      message: "The older question.",
      personal,
      referenceId: "SUP-OLD00001",
      subject: "Older",
    });
    await seedTicket(db, {
      category: "billing",
      createdAt: NOW,
      id: "ticket-new",
      message: "I was charged twice.",
      personal,
      referenceId: "SUP-NEW00001",
      status: "in_progress",
      subject: "Charged twice",
    });

    const view = await listAdminSupport({ clock, db, personal }, { limit: 50, status: "all" });

    expect(view.items.map((ticket) => ticket.id)).toEqual(["ticket-new", "ticket-old"]);
    expect(view.items[0]).toMatchObject({
      category: "billing",
      message: "I was charged twice.",
      status: "in_progress",
      subject: "Charged twice",
      userEmail: AUTHOR.email,
      userId: AUTHOR.id,
      userName: AUTHOR.name,
    });
    expect(view.items[0]?.createdAt).toBe(NOW);
    expect(view.openCount).toBe(1);
    expect(view.total).toBe(2);
    expect(view.now).toBe(NOW);
  });

  test("filters by status and keeps an unreadable message in the list", async () => {
    const { db, personal } = fresh();

    await seedTicket(db, {
      createdAt: NOW - 1000,
      id: "ticket-open",
      message: "Still waiting on an answer.",
      personal,
      referenceId: "SUP-OPEN0001",
    });
    await seedTicket(db, {
      createdAt: NOW,
      id: "ticket-closed",
      message: "Done and closed.",
      personal,
      referenceId: "SUP-CLOS0001",
      status: "closed",
    });

    db.update(supportTickets)
      .set({ messageEnc: "not-a-sealed-value" })
      .where(eq(supportTickets.id, "ticket-open"))
      .run();

    const view = await listAdminSupport({ clock, db, personal }, { limit: 50, status: "open" });

    expect(view.total).toBe(1);
    expect(view.openCount).toBe(1);
    expect(view.items[0]?.message).toBeNull();
    expect(view.items[0]?.referenceId).toBe("SUP-OPEN0001");
  });

  test("the open count never counts a settled ticket", async () => {
    const { db, personal } = fresh();

    await seedTicket(db, {
      createdAt: NOW - 2000,
      id: "ticket-in-progress",
      message: "A question.",
      personal,
      referenceId: "SUP-PROG0001",
      status: "in_progress",
    });
    await seedTicket(db, {
      createdAt: NOW - 1000,
      id: "ticket-resolved",
      message: "A question.",
      personal,
      referenceId: "SUP-RESO0001",
      status: "resolved",
    });

    expect(openSupportTicketCount(db)).toBe(0);
  });
});

describe("a support ticket update", () => {
  test("answers not_found for an unknown ticket and writes no audit row", async () => {
    const { db, personal } = fresh();

    const result = await updateAdminSupportTicket(
      { clock, db, personal },
      { actorId: "owner-1", id: "missing", update: { status: "resolved" } },
    );

    expect(result).toEqual({ outcome: "not_found" });
    expect(auditRows(db)).toEqual([]);
  });

  test("moves the ticket, stamps the resolution and records the audit in one write", async () => {
    const { db, personal } = fresh();

    await seedTicket(db, {
      createdAt: NOW - 1000,
      id: "ticket-1",
      message: "Please close this.",
      personal,
      referenceId: "SUP-UPD00001",
    });

    const result = await updateAdminSupportTicket(
      { clock, db, personal },
      {
        actorId: "owner-1",
        id: "ticket-1",
        update: { adminNotes: "  Answered by mail.  ", status: "resolved" },
      },
    );

    expect(result.outcome).toBe("updated");

    if (result.outcome !== "updated") {
      return;
    }

    expect(result.ticket).toMatchObject({
      adminNotes: "Answered by mail.",
      message: "Please close this.",
      resolvedAt: NOW,
      status: "resolved",
      updatedAt: NOW,
    });

    const stored = db.select().from(supportTickets).where(eq(supportTickets.id, "ticket-1")).get();

    expect(stored).toMatchObject({
      adminNotes: "Answered by mail.",
      status: "resolved",
    });
    expect(stored?.resolvedAt?.getTime()).toBe(NOW);

    const audits = auditRows(db);

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "support.update",
      actorId: "owner-1",
      targetUserId: AUTHOR.id,
    });
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toMatchObject({
      from: "open",
      notesChanged: true,
      referenceId: "SUP-UPD00001",
      to: "resolved",
    });
  });

  test("keeps the first resolution time and clears it when a ticket reopens", async () => {
    const { db, personal } = fresh();

    await seedTicket(db, {
      createdAt: NOW - 5000,
      id: "ticket-1",
      message: "A question.",
      personal,
      referenceId: "SUP-KEEP0001",
      status: "resolved",
    });

    db.update(supportTickets)
      .set({ resolvedAt: new Date(NOW - 4000) })
      .run();

    await updateAdminSupportTicket(
      { clock, db, personal },
      {
        actorId: "owner-1",
        id: "ticket-1",
        update: { adminNotes: "Still checking.", status: "resolved" },
      },
    );

    expect(
      db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, "ticket-1"))
        .get()
        ?.resolvedAt?.getTime(),
    ).toBe(NOW - 4000);

    await updateAdminSupportTicket(
      { clock, db, personal },
      { actorId: "owner-1", id: "ticket-1", update: { status: "open" } },
    );

    const reopened = db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, "ticket-1"))
      .get();

    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.adminNotes).toBe("Still checking.");
  });

  test("an empty note clears it", async () => {
    const { db, personal } = fresh();

    await seedTicket(db, {
      createdAt: NOW - 5000,
      id: "ticket-1",
      message: "A question.",
      personal,
      referenceId: "SUP-CLEAR001",
    });

    await updateAdminSupportTicket(
      { clock, db, personal },
      {
        actorId: "owner-1",
        id: "ticket-1",
        update: { adminNotes: "Temporary note", status: "open" },
      },
    );
    await updateAdminSupportTicket(
      { clock, db, personal },
      { actorId: "owner-1", id: "ticket-1", update: { adminNotes: "", status: "open" } },
    );

    expect(
      db.select().from(supportTickets).where(eq(supportTickets.id, "ticket-1")).get()?.adminNotes,
    ).toBeNull();
  });
});

describe("a support reply", () => {
  test("mails the author quoting the reference and records the audit", async () => {
    const { db, personal } = fresh();
    const mail = createSinkMailSender(clock);

    clearSinkMail();

    await seedTicket(db, {
      createdAt: NOW - 1000,
      id: "ticket-1",
      message: "My question.",
      personal,
      referenceId: "SUP-REPLY001",
      subject: "Charged twice",
    });

    const result = await replyToSupportTicket(
      { clock, db, mail, personal },
      { actorId: "owner-1", id: "ticket-1", message: "We fixed the duplicate charge." },
    );

    expect(result).toEqual({ outcome: "sent", referenceId: "SUP-REPLY001" });

    const sent = listSinkMail();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      subject: "[Ref: SUP-REPLY001] Re: Charged twice",
      to: AUTHOR.email,
    });
    expect(sent[0]?.body).toContain("We fixed the duplicate charge.");
    expect(sent[0]?.body).toContain("SUP-REPLY001");

    const audits = auditRows(db);

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "support.reply",
      actorId: "owner-1",
      targetUserId: AUTHOR.id,
    });
  });

  test("answers not_found for an unknown ticket", async () => {
    const { db, personal } = fresh();
    const mail = createSinkMailSender(clock);

    clearSinkMail();

    const result = await replyToSupportTicket(
      { clock, db, mail, personal },
      { actorId: "owner-1", id: "missing", message: "Hello" },
    );

    expect(result).toEqual({ outcome: "not_found" });
    expect(listSinkMail()).toEqual([]);
    expect(auditRows(db)).toEqual([]);
  });

  test("a failed send leaves no audit row behind", async () => {
    const { db, personal } = fresh();
    const mail = createSinkMailSender(clock);

    clearSinkMail();
    failNextSinkMail();

    await seedTicket(db, {
      createdAt: NOW - 1000,
      id: "ticket-1",
      message: "My question.",
      personal,
      referenceId: "SUP-FAIL0001",
    });

    const result = await replyToSupportTicket(
      { clock, db, mail, personal },
      { actorId: "owner-1", id: "ticket-1", message: "Trying again." },
    );

    expect(result).toEqual({ outcome: "mail_failed", referenceId: "SUP-FAIL0001" });
    expect(listSinkMail()).toEqual([]);
    expect(auditRows(db)).toEqual([]);
  });
});
