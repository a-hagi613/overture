import { describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { events, mailboxes, users } from "../platform/db/schema.ts";
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
