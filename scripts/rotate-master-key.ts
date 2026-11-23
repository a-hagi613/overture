import { parseArgs } from "node:util";

import {
  enqueueMasterKeyRotation,
  runMasterKeyRotation,
} from "../src/server/admin/key-rotation.ts";
import { databasePath as envDatabasePath, masterKeyring } from "../src/server/config/env.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";

const args = parseArgs({
  options: {
    "batch-size": { type: "string" },
    db: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    enqueue: { type: "boolean", default: false },
  },
  strict: true,
});

const databasePath = args.values.db ?? envDatabasePath;
const dryRun = args.values["dry-run"];

const batchRows =
  args.values["batch-size"] === undefined ? undefined : Number(args.values["batch-size"]);

if (batchRows !== undefined && (!Number.isInteger(batchRows) || batchRows < 1)) {
  throw new Error("--batch-size must be a positive integer.");
}

const { db, sqlite } = openDatabase(databasePath);
const clock = createClock();

try {
  if (args.values.enqueue) {
    const job = enqueueMasterKeyRotation(db, clock, { dryRun });

    process.stdout.write(
      `${JSON.stringify({ database: databasePath, dryRun, ...job }, null, 2)}\n`,
    );
  } else {
    const rotation = { db, clock, dryRun, keyring: masterKeyring };

    const summary = await runMasterKeyRotation(
      batchRows === undefined ? rotation : { ...rotation, batchRows },
    );

    process.stdout.write(`${JSON.stringify({ database: databasePath, ...summary }, null, 2)}\n`);
  }
} finally {
  sqlite.close();
}
