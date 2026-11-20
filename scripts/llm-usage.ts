import { parseArgs } from "node:util";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { readLlmUsage } from "../src/server/platform/llm/usage.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    purpose: { type: "string" },
    limit: { type: "string", default: "100" },
  },
  strict: true,
});

const databasePath = args.values.db;

if (databasePath === undefined) {
  throw new Error(
    "usage: bun run scripts/llm-usage.ts --db <overture.db> [--purpose <key>] [--limit <n>]",
  );
}

const parsedLimit = Number(args.values.limit);

if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
  throw new Error("--limit must be a positive number");
}

const { db } = openDatabase(databasePath);

const summary = readLlmUsage(db, {
  purpose: args.values.purpose ?? null,
  sinceMs: null,
  limit: Math.trunc(parsedLimit),
});

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
