import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { events, mailboxes, retiredAddresses, users } from "../platform/db/schema.ts";
import { createMailboxService } from "./mailboxes.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);
const SECRET = "aaaaaaaaaaaaaaaa";
const DOMAIN = "mail.example.test";

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      id: "user-1",
      name: "Person One",
      email: "person@example.com",
      emailVerified: true,
      role: "user",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();

  return { db, sqlite };
}

describe("a mailbox read that must not write", () => {
  test("returns null and allocates nothing for a person with no mailbox", () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    expect(service.readFor("user-1")).toBeNull();
    expect(db.select().from(mailboxes).all()).toHaveLength(0);

    sqlite.close();
  });

  test("returns the existing mailbox without changing it", async () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    const created = await service.ensureFor("user-1");

    expect(service.readFor("user-1")).toEqual(created);
    expect(db.select().from(mailboxes).all()).toHaveLength(1);

    sqlite.close();
  });
});

describe("a mailbox write the other tab must see", () => {
  test("publishes when the mailbox is created", async () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    await service.ensureFor("user-1");

    const published = db.select().from(events).all();

    expect(published.map((row) => row.topic)).toEqual(["mailbox.updated"]);
    expect(published[0]?.userId).toBe("user-1");

    sqlite.close();
  });

  test("publishes when the first forwarded message arrives, and once only", () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    db.insert(mailboxes)
      .values({ createdAt: new Date(NOW), id: "mailbox-1", localPart: "one", userId: "user-1" })
      .run();

    service.markFirstForwarded("mailbox-1", NOW);
    service.markFirstForwarded("mailbox-1", NOW + 1000);

    const published = db
      .select()
      .from(events)
      .all()
      .filter((row) => row.topic === "mailbox.updated");

    expect(published).toHaveLength(1);
    expect(published[0]?.userId).toBe("user-1");

    sqlite.close();
  });
});

function addPerson(db: ReturnType<typeof migrated>["db"], id: string, name: string, email: string) {
  db.insert(users)
    .values({
      id,
      name,
      email,
      emailVerified: true,
      role: "user",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
}

describe("a readable apply alias", () => {
  test("is assigned from the name on the alias domain, beside the forwarding address", async () => {
    const { db, sqlite } = migrated();

    const service = createMailboxService(
      db,
      { now: () => NOW },
      SECRET,
      DOMAIN,
      "alias.example.test",
    );

    const mailbox = await service.ensureFor("user-1");

    expect(mailbox.applyAddress).toBe("person.one@alias.example.test");
    expect(mailbox.address).toContain(`@${DOMAIN}`);
    expect(mailbox.address).not.toBe(mailbox.applyAddress);

    sqlite.close();
  });

  test("defaults its domain to MAIL_DOMAIN", async () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    expect((await service.ensureFor("user-1")).applyAddress).toBe(`person.one@${DOMAIN}`);

    sqlite.close();
  });

  test("gives two people with the same name different aliases", async () => {
    const { db, sqlite } = migrated();
    addPerson(db, "user-2", "Person One", "second@example.com");
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    const first = await service.ensureFor("user-1");
    const second = await service.ensureFor("user-2");

    expect(first.applyAddress).toBe(`person.one@${DOMAIN}`);
    expect(second.applyAddress).not.toBe(first.applyAddress);
    expect(second.applyAddress?.startsWith("person.one.")).toBe(true);

    sqlite.close();
  });

  test("is never a system local part, even for a person named after one", async () => {
    const { db, sqlite } = migrated();
    addPerson(db, "user-2", "Support", "help@example.com");
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

    const mailbox = await service.ensureFor("user-2");
    const localPart = mailbox.applyAddress?.split("@")[0] ?? "";

    expect(localPart === "support" || localPart.startsWith("support.")).toBe(false);
    expect(localPart.startsWith("person")).toBe(true);

    sqlite.close();
  });

  test("is backfilled onto a mailbox created before aliases existed", async () => {
    const { db, sqlite } = migrated();

    db.insert(mailboxes)
      .values({ createdAt: new Date(NOW), id: "mailbox-1", localPart: "legacy", userId: "user-1" })
      .run();

    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);
    const mailbox = await service.ensureFor("user-1");

    expect(mailbox.applyAddress).toBe(`person.one@${DOMAIN}`);
    expect(mailbox.address).toBe(`legacy@${DOMAIN}`);

    sqlite.close();
  });

  test("resolves inbound mail addressed to the alias and retires the forwarding address", async () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);
    const mailbox = await service.ensureFor("user-1");
    const applyAddress = mailbox.applyAddress ?? "";

    expect((await service.byForwardingAddress(applyAddress))?.id).toBe(mailbox.id);
    expect((await service.byForwardingAddress(applyAddress.toUpperCase()))?.id).toBe(mailbox.id);
    expect(await service.byForwardingAddress(mailbox.address)).toBeNull();
    expect(await service.byForwardingAddress(`nobody@${DOMAIN}`)).toBeNull();

    sqlite.close();
  });

  test("is retired on delete and never assigned again", async () => {
    const { db, sqlite } = migrated();
    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);
    const mailbox = await service.ensureFor("user-1");
    const localPart = mailbox.applyAddress?.split("@")[0] ?? "";

    service.retireFor("user-1");

    expect(
      db
        .select({ localPart: retiredAddresses.localPart })
        .from(retiredAddresses)
        .all()
        .map((row) => row.localPart),
    ).toContain(localPart);

    expect(() =>
      db
        .insert(mailboxes)
        .values({
          applyAddress: mailbox.applyAddress,
          createdAt: new Date(NOW),
          id: "mailbox-2",
          localPart: "another-local-part",
          userId: "user-2",
        })
        .run(),
    ).toThrow(/retired apply alias/u);

    sqlite.close();
  });
});

describe("the alias backfill", () => {
  test("assigns only a missing alias and never replaces one already handed out", async () => {
    const { db, sqlite } = migrated();
    addPerson(db, "user-2", "Person Two", "second@example.com");

    db.insert(mailboxes)
      .values({
        applyAddress: `kept@${DOMAIN}`,
        createdAt: new Date(NOW),
        id: "mailbox-kept",
        localPart: "kept-local",
        userId: "user-1",
      })
      .run();

    db.insert(mailboxes)
      .values({
        createdAt: new Date(NOW),
        id: "mailbox-missing",
        localPart: "missing-local",
        userId: "user-2",
      })
      .run();

    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);
    const summary = await service.ensureForAll();

    expect(summary).toEqual({ created: 0, existing: 2, total: 2 });
    expect(service.readFor("user-1")?.applyAddress).toBe(`kept@${DOMAIN}`);
    expect(service.readFor("user-2")?.applyAddress).toBe(`person.two@${DOMAIN}`);

    sqlite.close();
  });
});

describe("a retired alias on the update path", () => {
  test("cannot be assigned to a mailbox that had no alias yet", async () => {
    const { db, sqlite } = migrated();
    addPerson(db, "user-2", "Person Two", "second@example.com");

    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);
    const retired = await service.ensureFor("user-1");
    const retiredLocalPart = retired.applyAddress?.split("@")[0] ?? "";

    service.retireFor("user-1");

    db.insert(mailboxes)
      .values({
        createdAt: new Date(NOW),
        id: "mailbox-3",
        localPart: "unaliased",
        userId: "user-2",
      })
      .run();

    expect(() =>
      db
        .update(mailboxes)
        .set({ applyAddress: `${retiredLocalPart}@${DOMAIN}` })
        .where(eq(mailboxes.id, "mailbox-3"))
        .run(),
    ).toThrow(/retired apply alias/u);

    sqlite.close();
  });
});

describe("a handle kept unique across domains", () => {
  test("is not reused when someone else already has it on another alias domain", async () => {
    const { db, sqlite } = migrated();
    addPerson(db, "user-2", "Person One", "second@example.com");

    db.insert(mailboxes)
      .values({
        applyAddress: "person.one@other.example.test",
        createdAt: new Date(NOW),
        id: "mailbox-2",
        localPart: "other-local-part",
        userId: "user-2",
      })
      .run();

    const service = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);
    const mailbox = await service.ensureFor("user-1");

    expect(mailbox.applyAddress).not.toBe(`person.one@${DOMAIN}`);
    expect(mailbox.applyAddress?.startsWith("person.one.")).toBe(true);

    sqlite.close();
  });
});
