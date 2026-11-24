import { describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { events, mailboxes, users } from "../platform/db/schema.ts";
import { createMailboxService } from "../inbox/mailboxes.ts";
import { createApplyEmailService } from "./apply-email.ts";

const NOW = Date.UTC(2026, 10, 23, 9, 0, 0);
const SECRET = "aaaaaaaaaaaaaaaa";
const DOMAIN = "mail.example.test";

function ready() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      id: "user-1",
      name: "Alex Chen",
      email: "alex@example.com",
      emailVerified: true,
      role: "user",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();

  const mailboxesService = createMailboxService(db, { now: () => NOW }, SECRET, DOMAIN);

  const service = createApplyEmailService({
    clock: { now: () => NOW },
    db,
    mailboxes: mailboxesService,
  });

  return { db, service, sqlite };
}

describe("the personal-email preference", () => {
  test("defaults to the assigned alias and reads the sign-in email as the personal one", async () => {
    const { db, service, sqlite } = ready();

    const state = await service.ensure("user-1", true);

    expect(state).toEqual({
      applyAddress: "alex.chen@mail.example.test",
      personalEmail: "alex@example.com",
      usePersonalEmail: false,
    });

    expect(db.select().from(mailboxes).all()).toHaveLength(1);

    sqlite.close();
  });
  test("saves the choice and announces it so another tab refreshes", async () => {
    const { db, service, sqlite } = ready();

    await service.ensure("user-1", true);

    const saved = await service.save("user-1", { usePersonalEmail: true });

    expect(saved.usePersonalEmail).toBe(true);
    expect(service.read("user-1").usePersonalEmail).toBe(true);
    expect(
      db
        .select({ payload: events.payload, topic: events.topic })
        .from(events)
        .all()
        .some((row) => row.topic === "profile.updated" && row.payload.includes("applyEmail")),
    ).toBe(true);

    expect((await service.save("user-1", { usePersonalEmail: false })).usePersonalEmail).toBe(
      false,
    );

    sqlite.close();
  });

  test("a read-only check assigns no mailbox", async () => {
    const { db, service, sqlite } = ready();

    const state = await service.ensure("user-1", false);

    expect(state.applyAddress).toBeNull();
    expect(db.select().from(mailboxes).all()).toHaveLength(0);

    sqlite.close();
  });
});
