import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { buildCensus, renderCensusMarkdown } from "../src/server/catalog/census.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    out: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;
const outputPath = args.values.out;

if (databasePath === undefined || outputPath === undefined) {
  throw new Error("usage: bun run scripts/census.ts --db <overture.db> --out <census.md>");
}

const { db } = openDatabase(databasePath);

const markup = renderCensusMarkdown(buildCensus(db, createClock()));

writeFileSync(outputPath, `${markup}\n`);

process.stdout.write(markup);
