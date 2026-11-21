import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createMailboxService } from "../../src/server/inbox/mailboxes.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { mailboxes, retiredAddresses, users } from "../../src/server/platform/db/schema.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";
import { testAuthEnvironment } from "./auth.fixture.ts";

const secret = "e2e-backfill-hmac-secret-0123456789";

const summarySchema = z.object({
  created: z.number(),
  existing: z.number(),
  total: z.number(),
});

const retiredRowSchema = z.object({
  local_part: z.string(),
  retired_at: z.number().int(),
});

function freshDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "overture-mailboxes-"));
  const databasePath = join(directory, "overture.db");
  const { db, sqlite } = openDatabase(databasePath);

  migrateDatabase(db, "drizzle");

  const at = new Date();

  db.insert(users)
    .values([
      {
        id: "owner-account",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        role: "owner",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "burner-account",
        name: "Burner",
        email: "burner@example.com",
        emailVerified: true,
        role: "user",
        createdAt: at,
        updatedAt: at,
      },
    ])
    .run();

  sqlite.close();

  return databasePath;
}

function runBackfill(databasePath: string) {
  const result = spawnSync("bun", ["run", "scripts/backfill-mailboxes.ts", "--db", databasePath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...testAuthEnvironment,
      DATABASE_URL: databasePath,
      INBOUND_HMAC_SECRET: secret,
      MAIL_DOMAIN: "tryoverture.com",
      NODE_ENV: "test",
    },
  });

  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`scripts/backfill-mailboxes.ts failed: ${result.stderr}`);
  }

  return summarySchema.parse(JSON.parse(result.stdout));
}

test("the backfill gives the owner and burner accounts one address each, idempotently", () => {
  const databasePath = freshDatabase();

  expect(runBackfill(databasePath)).toEqual({ created: 2, existing: 0, total: 2 });
  expect(runBackfill(databasePath)).toEqual({ created: 0, existing: 2, total: 2 });

  const { db, sqlite } = openDatabase(databasePath);

  try {
    const rows = db.select().from(mailboxes).all();

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(
      new Set(["owner-account", "burner-account"]),
    );
    expect(rows.every((row) => row.status === "active")).toBe(true);
    expect(rows.every((row) => row.firstForwardedAt === null)).toBe(true);
    expect(new Set(rows.map((row) => row.localPart)).size).toBe(2);
  } finally {
    sqlite.close();
  }
});

test("a retired local part is recorded for good and never assigned again", async () => {
  const databasePath = freshDatabase();

  runBackfill(databasePath);

  const { db, sqlite } = openDatabase(databasePath);

  try {
    const clock = createClock();
    const mailboxesService = createMailboxService(db, clock, secret, "tryoverture.com");

    const [ownerMailbox] = db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.userId, "owner-account"))
      .all();

    if (ownerMailbox === undefined) {
      throw new Error("The owner has no mailbox to retire.");
    }

    expect(mailboxesService.retireFor("owner-account")).toBe(true);
    expect(mailboxesService.retireFor("owner-account")).toBe(false);
    expect(
      db
        .select()
        .from(retiredAddresses)
        .all()
        .map((row) => row.localPart),
    ).toContain(ownerMailbox.localPart);

    const retired = db
      .select()
      .from(retiredAddresses)
      .where(eq(retiredAddresses.localPart, ownerMailbox.localPart))
      .get();

    if (retired === undefined) {
      throw new Error("The retired local part was not recorded.");
    }

    const nowSeconds = Math.floor(clock.now() / 1000);

    const rawRows = z
      .array(retiredRowSchema)
      .parse(sqlite.query("select local_part, retired_at from retired_addresses").all());

    const raw = rawRows.find((row) => row.local_part === ownerMailbox.localPart);

    expect(raw).toBeDefined();
    expect(raw?.retired_at).toBeLessThan(100_000_000_000);
    expect(raw?.retired_at).toBeGreaterThan(nowSeconds - 120);
    expect(raw?.retired_at).toBeLessThan(nowSeconds + 120);
    expect(retired.retiredAt.getTime()).toBe((raw?.retired_at ?? 0) * 1000);

    const replacement = await mailboxesService.ensureFor("owner-account");

    expect(replacement.address).not.toBe(`${ownerMailbox.localPart}@tryoverture.com`);

    expect(() =>
      db
        .insert(mailboxes)
        .values({
          id: crypto.randomUUID(),
          localPart: ownerMailbox.localPart,
          status: "active",
          userId: "burner-account",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow("never reassigned");
  } finally {
    sqlite.close();
  }
});
