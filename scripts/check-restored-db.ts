import { readFileSync } from "node:fs";

import { z } from "zod";

import { verifyRestoredDatabase } from "../src/server/platform/db/restore-check.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string() })),
});

const databasePathSchema = z.string().min(1);

function journalMigrationCount() {
  try {
    const journal = journalSchema.parse(
      JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")),
    );

    return journal.entries.length;
  } catch {
    return null;
  }
}

const [restoredDatabasePath] = process.argv.slice(2);

const path = databasePathSchema.parse(restoredDatabasePath);
const expectedMigrations = journalMigrationCount();

const report = verifyRestoredDatabase(path, {
  now: createClock().now(),
  ...(expectedMigrations !== null && { expectedMigrations }),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  throw new Error(`restored database checks failed: ${report.failures.join("; ")}`);
}

process.stdout.write("restore check passed\n");
