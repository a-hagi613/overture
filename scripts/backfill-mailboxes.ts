import { parseArgs } from "node:util";

import { aliasEmailDomain, env } from "../src/server/config/env.ts";
import { createMailboxService } from "../src/server/inbox/mailboxes.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const args = parseArgs({ options: { db: { type: "string" } }, strict: true });

const databasePath = args.values.db;

if (databasePath === undefined) {
  throw new Error(
    "usage: bun run scripts/backfill-mailboxes.ts --db <overture.db> (gives every user without one a forwarding address and every mailbox without one a readable apply alias, the owner and burner included; safe to re-run)",
  );
}

const secret = env.INBOUND_HMAC_SECRET;

if (secret === undefined) {
  throw new Error("INBOUND_HMAC_SECRET must be set to generate forwarding addresses.");
}

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const mailboxes = createMailboxService(
  db,
  createClock(),
  secret,
  env.MAIL_DOMAIN,
  aliasEmailDomain,
);

const summary = await mailboxes.ensureForAll();

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
