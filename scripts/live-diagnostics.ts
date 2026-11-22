import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { z } from "zod";

import { catalogDatabasePath, databasePath, env } from "../src/server/config/env.ts";

const credentialNames = [
  "OWNER_EMAIL",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "BROWSER_USE_API_KEY",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_WEEK",
  "STRIPE_PRICE_MONTH",
  "CARD_FINGERPRINT_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "INBOUND_HMAC_SECRET",
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

write("credential and id presence (names only; values are never printed)");

for (const name of credentialNames) {
  const value = env[name];

  write(`${name}: ${value === undefined || value === "" ? "missing" : "present"}`);
}

write("runtime configuration (non-secret values)");

write(`PUBLIC_SIGNUP_ENABLED: ${String(env.PUBLIC_SIGNUP_ENABLED)}`);

write(`DEMO_LOGIN_ENABLED: ${String(env.DEMO_LOGIN_ENABLED)}`);

write(`REQUIRE_EMAIL_SENDING: ${String(env.REQUIRE_EMAIL_SENDING)}`);

write(`ANTHROPIC_MODEL: ${env.ANTHROPIC_MODEL}`);

write(`BROWSER_PROVIDER: ${env.BROWSER_PROVIDER ?? "unset"}`);

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
