import { expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { codeWaits, mailboxes, users } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { waitForCode } from "./waits.ts";

const MASTER = new Uint8Array(32).fill(3);
const USER_ID = "wait-user";
const WAIT_ID = "wait-1";

function seeded() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      createdAt: now,
      email: "wait@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Wait",
      role: "owner",
      updatedAt: now,
    })
    .run();

  db.insert(mailboxes)
    .values({ createdAt: now, id: "mailbox-1", localPart: "wait", userId: USER_ID })
    .run();

  db.insert(codeWaits)
    .values({
      attemptId: null,
      expiresAt: new Date(clock.now() + 600_000),
      id: WAIT_ID,
      mailboxId: "mailbox-1",
      startedAt: now,
      userId: USER_ID,
    })
    .run();

  return { clock, db, sqlite };
}

test("aborting a code wait clears the interval and resolves null", async () => {
  const { clock, db, sqlite } = seeded();
  const personal = createPersonalCrypto(db, MASTER, 1);
  const controller = new AbortController();
  let asked = false;

  const pending = waitForCode(
    { clock, db, personal },
    {
      onAskToPaste: () => {
        asked = true;
      },
      waitId: WAIT_ID,
    },
    { signal: controller.signal },
  );

  controller.abort();

  expect(await pending).toBeNull();
  expect(asked).toBe(false);

  sqlite.close();
});
