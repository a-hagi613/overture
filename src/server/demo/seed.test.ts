import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import { addLocalDays, localDateAt, localDayStartFor } from "../platform/local-time.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { applications } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { seedDemoAccount } from "./seed.ts";

const ZONE = "America/Toronto";

test("seeding just after Toronto midnight still fills all seven days of the 7D activity chart", async () => {
  const now = Date.parse("2026-11-24T05:05:00Z");
  const directory = mkdtempSync(join(tmpdir(), "overture-demo-seed-"));
  const { db, sqlite } = openCountingDatabase();
  const catalog = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  try {
    const { userId } = await seedDemoAccount({
      catalogDb: catalog.db,
      clock: { now: () => now },
      db,
      objects: createDiskObjectStore(directory),
      personal: createPersonalCrypto(db, masterKeyringFor(new Uint8Array(32).fill(5))),
    });

    const sentRows = db
      .select({ at: applications.sentAt, id: applications.id })
      .from(applications)
      .where(eq(applications.userId, userId))
      .all()
      .flatMap((row) => (row.at === null ? [] : [{ at: row.at, id: row.id }]));

    const today = localDateAt(now, ZONE);

    const countFor = (offsetDays: number) => {
      const start = localDayStartFor(addLocalDays(today, offsetDays), ZONE);
      const end = localDayStartFor(addLocalDays(today, offsetDays + 1), ZONE);

      return sentRows.filter((row) => row.at >= start && row.at < end).length;
    };

    for (let offsetDays = -6; offsetDays <= 0; offsetDays += 1) {
      expect(countFor(offsetDays)).toBeGreaterThan(0);
    }

    expect(sentRows.every((row) => row.at <= now)).toBe(true);

    const todayStart = localDayStartFor(today, ZONE);

    expect(sentRows.find((row) => row.id === "demo-app-07")?.at).toBe(todayStart);
  } finally {
    sqlite.close();
    catalog.sqlite.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
