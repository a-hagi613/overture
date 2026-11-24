import { expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { codeWaits, mailboxes, users } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import { waitForCode, wakeCodeWaits } from "./waits.ts";

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
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const controller = new AbortController();
  let asked = false;

  const pending = waitForCode(
    { clock, db, personal },
    {
      askDelayMs: 60_000,
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

test("a wait created with an already-aborted signal settles at once", async () => {
  const { clock, db, sqlite } = seeded();
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const controller = new AbortController();

  controller.abort();

  const startedAt = performance.now();

  const pending = waitForCode(
    { clock, db, personal },
    { askDelayMs: 0, onAskToPaste: () => undefined, waitId: WAIT_ID },
    { signal: controller.signal },
  );

  const settled = await pending;

  expect(settled).toBeNull();
  expect(performance.now() - startedAt).toBeLessThan(500);

  sqlite.close();
});

async function tick() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
}

const askedWithin: (check: () => boolean, deadline?: number) => Promise<boolean> = async (
  check,
  deadline = performance.now() + 1000,
) => {
  if (check() || performance.now() >= deadline) {
    return check();
  }

  await tick();

  return askedWithin(check, deadline);
};

test("a personal-mode wait asks for a paste at once (#565)", async () => {
  const { clock, db, sqlite } = seeded();
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const controller = new AbortController();
  let asked = false;

  const pending = waitForCode(
    { clock, db, personal },
    {
      askDelayMs: 0,
      onAskToPaste: () => {
        asked = true;
      },
      waitId: WAIT_ID,
    },
    { signal: controller.signal },
  );

  expect(await askedWithin(() => asked)).toBe(true);

  controller.abort();
  expect(await pending).toBeNull();

  sqlite.close();
});

test("an alias wait gives the Email Worker 45 seconds before asking (#565)", async () => {
  const { clock, db, sqlite } = seeded();
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const controller = new AbortController();
  let asked = false;

  const pending = waitForCode(
    { clock, db, personal },
    {
      askDelayMs: 45_000,
      onAskToPaste: () => {
        asked = true;
      },
      waitId: WAIT_ID,
    },
    { signal: controller.signal },
  );

  await tick();
  expect(asked).toBe(false);

  clock.setOffset(44_000);
  wakeCodeWaits();
  await tick();
  expect(asked).toBe(false);

  clock.setOffset(46_000);
  wakeCodeWaits();
  expect(await askedWithin(() => asked)).toBe(true);

  controller.abort();
  expect(await pending).toBeNull();

  sqlite.close();
});

test("a broken alert never settles the wait or escapes the loop (#565)", async () => {
  const { clock, db, sqlite } = seeded();
  const personal = createPersonalCrypto(db, masterKeyringFor(MASTER));
  const controller = new AbortController();
  let attempts = 0;

  const pending = waitForCode(
    { clock, db, personal },
    {
      askDelayMs: 0,
      onAskToPaste: () => {
        attempts += 1;

        throw new Error("mail is down");
      },
      waitId: WAIT_ID,
    },
    { signal: controller.signal },
  );

  expect(await askedWithin(() => attempts > 0)).toBe(true);

  controller.abort();
  expect(await pending).toBeNull();
  expect(attempts).toBe(1);

  sqlite.close();
});
