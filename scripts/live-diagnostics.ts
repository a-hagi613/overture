import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { z } from "zod";

import { catalogDatabasePath, databasePath, env } from "../src/server/config/env.ts";

const runtimeNames = [
  "OWNER_EMAIL",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "BROWSER_USE_API_KEY",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_WEEK",
  "STRIPE_PRICE_MONTH",
  "CARD_FINGERPRINT_SECRET",
  "VAPID_PUBLIC_KEY",
  "INBOUND_HMAC_SECRET",
  "PUBLIC_SIGNUP_ENABLED",
  "DEMO_LOGIN_ENABLED",
] as const;

const applicationTables = ["users", "invites", "applications"] as const;

const catalogTables = ["company_boards", "postings"] as const;

const countSchema = z.object({ count: z.number().int().nonnegative() });

function write(line: string) {
  process.stdout.write(`${line}\n`);
}

function countRows(path: string, tables: readonly string[]) {
  const sqlite = new Database(path, { readonly: true });

  sqlite.run("PRAGMA busy_timeout = 5000;");

  const lines = tables.map((table) => {
    const row = countSchema.parse(sqlite.query(`select count(*) as count from ${table}`).get());

    return `${table}: ${String(row.count)}`;
  });

  sqlite.close();

  return lines;
}

write("runtime environment (names only)");

for (const name of runtimeNames) {
  const value = env[name];

  write(`${name}: ${value === undefined || value === "" ? "missing" : "present"}`);
}

write("sqlite application counts (integers only)");

for (const line of countRows(databasePath, applicationTables)) {
  write(line);
}

write("sqlite catalog counts (integers only)");

if (existsSync(catalogDatabasePath)) {
  for (const line of countRows(catalogDatabasePath, catalogTables)) {
    write(line);
  }
} else {
  write(`catalog database not found at ${catalogDatabasePath}`);
}
