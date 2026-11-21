import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { env } from "../src/server/config/env.ts";
import { parseMasterKey } from "../src/server/platform/crypto.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { createPersonalCrypto } from "../src/server/profile/personal-crypto.ts";
import {
  buildReviewReport,
  DEFAULT_AUDIT_SAMPLE,
  DEFAULT_AUDIT_SEED,
  redactSnapshotAudit,
  sampleSnapshotAudit,
} from "../src/server/pipeline/review-report.ts";

const HOUR_MS = 60 * 60_000;

const args = parseArgs({
  options: {
    db: { type: "string" },
    out: { type: "string" },
    sample: { type: "string", default: String(DEFAULT_AUDIT_SAMPLE) },
    seed: { type: "string", default: DEFAULT_AUDIT_SEED },
    since: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;

if (databasePath === undefined) {
  throw new Error(
    "usage: bun run scripts/review-report.ts --db <overture.db> [--since <ISO date or epoch ms>] [--sample <n>] [--seed <text>] [--out <audit.json>]",
  );
}

function parseSince(value: string | undefined) {
  if (value === undefined) {
    return null;
  }

  if (/^\d+$/u.test(value)) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("--since must be an ISO date or epoch milliseconds");
    }

    return Math.trunc(parsed);
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    throw new TypeError("--since must be an ISO date or epoch milliseconds");
  }

  return parsed;
}

const since = parseSince(args.values.since);

const sample = Number(args.values.sample);

if (!Number.isInteger(sample) || sample < 1 || sample > 1000) {
  throw new TypeError("--sample must be a whole number between 1 and 1000");
}

const seed = args.values.seed.trim();

if (seed === "") {
  throw new Error("--seed must not be empty");
}

const { db } = openDatabase(databasePath);

const report = buildReviewReport(db, { since });

const personal = createPersonalCrypto(
  db,
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
  env.MASTER_KEY_CURRENT,
);

const audit = await sampleSnapshotAudit(db, personal, { sample, seed, since });

let written: string | null = null;

if (args.values.out !== undefined) {
  written = resolve(args.values.out);

  writeFileSync(written, `${JSON.stringify(audit, undefined, 2)}\n`, { mode: 0o600 });
  chmodSync(written, 0o600);
}

const generatedAt = createClock().now();

process.stdout.write(
  `${JSON.stringify(
    {
      generatedAt,
      out: written,
      report,
      audit: redactSnapshotAudit(audit),
      windowHours: since === null ? null : (generatedAt - since) / HOUR_MS,
    },
    undefined,
    2,
  )}\n`,
);
