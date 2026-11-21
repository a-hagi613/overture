import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";

import { env } from "../src/server/config/env.ts";
import { createQuestionCatalog } from "../src/server/catalog/questions.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { parseMasterKey } from "../src/server/platform/crypto.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { users } from "../src/server/platform/db/schema.ts";
import { createPersonalCrypto } from "../src/server/profile/personal-crypto.ts";
import { parseV1Export } from "../src/server/profile/v1-export.ts";
import { importV1Facts } from "../src/server/profile/v1-import.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    user: { type: "string" },
    in: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;
const email = args.values.user;
const exportPath = args.values.in;

if (databasePath === undefined || email === undefined || exportPath === undefined) {
  throw new Error(
    "usage: bun run scripts/import-v1-facts.ts --db <overture.db> --user <email> --in <export.json>",
  );
}

const exported = parseV1Export(readFileSync(exportPath, "utf8"));

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const clock = createClock();

const owner = db.select().from(users).where(eq(users.email, email)).get();

if (owner === undefined) {
  throw new Error(`no user has the email given to --user: ${email}`);
}

const personal = createPersonalCrypto(
  db,
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
  env.MASTER_KEY_CURRENT,
);

const catalog = createQuestionCatalog({ db, clock });

const report = await importV1Facts({
  db,
  clock,
  personal,
  catalog,
  userId: owner.id,
  exported,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
