import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { eq } from "drizzle-orm";

import { createMailDnsResolver } from "./dns.ts";
import { createMailboxService } from "./mailboxes.ts";
import { createMailIngest } from "./ingest.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { mailThreads, users } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

const MASTER = new Uint8Array(32).fill(9);
const USER_ID = "ingest-rollback-user";

const countSchema = z.object({ total: z.number() });

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fresh() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      createdAt: now,
      email: "inbox@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Inbox",
      role: "owner",
      updatedAt: now,
    })
    .run();

  const mailboxes = createMailboxService(db, clock, "test-secret", "example.test");

  return { clock, db, mailboxes, sqlite };
}

describe("the inbound mail transaction", () => {
  test("rolls the thread write back when the message insert fails", async () => {
    const { clock, db, mailboxes, sqlite } = fresh();
    const directory = mkdtempSync(join(tmpdir(), "mail-ingest-"));

    scratchDirectories.push(directory);

    const objects = createDiskObjectStore(directory);
    const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
    const mailbox = await mailboxes.ensureFor(USER_ID);

    const raw = new TextEncoder().encode(
      "Message-ID: <rollback@example.test>\nTo: inbox@example.test\nSubject: A rollback\n\nHello there.",
    );

    const objectKey = `mail/${USER_ID}/raw/rollback.eml`;

    const sealed = await personal.sealFor(
      USER_ID,
      { column: "body", rowId: objectKey, table: "mail_objects" },
      Buffer.from(raw).toString("base64"),
    );

    await objects.put(objectKey, new TextEncoder().encode(sealed));

    sqlite.run(
      "create trigger reject_message before insert on messages begin select raise(abort, 'forced message failure'); end",
    );

    const ingest = createMailIngest({
      clock,
      db,
      mailboxes,
      objects,
      personal,
      resolver: createMailDnsResolver(undefined),
    });

    let failed = false;

    try {
      await ingest.run(
        JSON.stringify({
          mailFrom: "",
          mailboxId: mailbox.id,
          objectKey,
          rcptTo: mailbox.address,
          receivedAt: clock.now(),
        }),
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);

    expect(
      countSchema.parse(
        sqlite.query("select count(*) as total from mail_threads where user_id = ?").get(USER_ID),
      ).total,
    ).toBe(0);
    expect(
      db
        .select({ id: mailThreads.id })
        .from(mailThreads)
        .where(eq(mailThreads.userId, USER_ID))
        .all(),
    ).toHaveLength(0);

    sqlite.close();
  });
});
