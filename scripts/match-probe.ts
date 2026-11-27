import type { TargetsInput } from "../src/shared/targets.ts";

import { catalogDatabasePath, databasePath, masterKeyring } from "../src/server/config/env.ts";
import { createCandidateService } from "../src/server/matching/candidates.ts";
import {
  openReadOnlyCatalogDatabase,
  openReadOnlyDatabase,
} from "../src/server/platform/db/client.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { createPersonalCrypto } from "../src/server/profile/personal-crypto.ts";

const PROBE_USER_ID = "match-probe";
const TOP = 5;

function persona(label: string, roles: string[], locations: string[]) {
  return {
    label,
    targets: {
      locations,
      roles,
      unresolvedLocations: [],
      unresolvedRoles: [],
    } satisfies TargetsInput,
  };
}

const personas = [
  persona("Registered Nurse · Toronto", ["healthcare", "nurse"], ["city:ca:toronto"]),
  persona("Backend Engineer · London", ["backend"], ["city:gb:london"]),
  persona("Data Scientist · New York", ["data_science"], ["city:us:new-york"]),
  persona("Account Executive · Toronto", ["sales"], ["city:ca:toronto"]),
  persona("Product Manager · Remote", ["product"], ["remote:worldwide"]),
];

const { db, sqlite } = openReadOnlyDatabase(databasePath);
const { db: catalogDb, sqlite: catalogSqlite } = openReadOnlyCatalogDatabase(catalogDatabasePath);

const candidates = createCandidateService({
  catalogDb,
  clock: createClock(),
  db,
  personal: createPersonalCrypto(db, masterKeyring),
});

try {
  const results = await Promise.all(
    personas.map(async ({ label, targets }) => ({
      label,
      ranked: await candidates.ranked(PROBE_USER_ID, targets, ["en"]),
    })),
  );

  for (const { label, ranked } of results) {
    process.stdout.write(`${label}: ${String(ranked.length)} matches\n`);

    for (const posting of ranked.slice(0, TOP)) {
      process.stdout.write(
        `  ${String(Math.round(posting.codeRank))} | ${posting.title} | ${posting.companyName} | ${posting.locationRaw} | ${posting.workplace}\n`,
      );
    }
  }
} finally {
  sqlite.close();
  catalogSqlite.close();
}
