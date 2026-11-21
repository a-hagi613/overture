import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createClock } from "../src/server/platform/ports/clock.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createConsentService } from "../src/server/profile/consent.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    file: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;
const filePath = args.values.file;

if (databasePath === undefined || filePath === undefined) {
  throw new Error(
    "usage: bun run scripts/publish-consent-version.ts --db <overture.db> --file <consent-text.txt>",
  );
}

const text = readFileSync(filePath, "utf8").trim();

if (text.length === 0) {
  throw new Error("the consent text file is empty");
}

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const published = createConsentService({ clock: createClock(), db }).publish(text);

process.stdout.write(
  `consent version ${published.version} published at ${published.publishedAt.toISOString()}\n`,
);
