import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { exportEntries } from "./archive.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { applications, users } from "../platform/db/schema.ts";

import type { ZipEntry } from "./zip.ts";

const USER_ID = "user-export-pages";
const SEEDED_APPLICATIONS = 30;
const LATE_APPLICATION_ID = "application-999";
const NOW = 1_800_000_000_000;

const exportedSchema = z.array(z.object({ id: z.string().min(1) }));

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function seededDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "export-archive-"));
  scratchDirectories.push(directory);

  const databasePath = join(directory, "app.sqlite");
  const { db, sqlite } = openDatabase(databasePath);

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "owner@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Owner",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();

  for (let index = 0; index < SEEDED_APPLICATIONS; index += 1) {
    db.insert(applications)
      .values({
        ats: "greenhouse",
        companyId: `company-${String(index)}`,
        companyName: "Ferro Cloud",
        companyNameNorm: "ferro cloud",
        createdAt: NOW + index,
        id: `application-${String(index).padStart(3, "0")}`,
        origin: "auto",
        postingId: `posting-${String(index)}`,
        postingTitle: "Senior Platform Engineer",
        postingUrl: "https://boards.example/jobs/1",
        status: "ready",
        updatedAt: NOW + index,
        userId: USER_ID,
      })
      .run();
  }

  const objects = createDiskObjectStore(join(directory, "objects"));
  const personal = createPersonalCrypto(db, masterKeyringFor(new Uint8Array(32).fill(7)));

  return { clock: createClock(), databasePath, db, objects, personal, sqlite };
}

function applicationsEntry(entries: Iterable<ZipEntry>) {
  for (const entry of entries) {
    if (entry.name === "applications.json") {
      return entry;
    }
  }

  throw new Error("the export has no applications.json entry");
}

describe("the account export's pagination", () => {
  test("reads each page in its own statement, so a commit between pages is visible", async () => {
    const { clock, databasePath, db, objects, personal, sqlite } = seededDatabase();

    const entry = applicationsEntry(
      exportEntries({ clock, db, mailDomain: "example.test", objects, personal }, USER_ID),
    );

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      for await (const chunk of entry.read()) {
        chunks.push(decoder.decode(chunk));

        if (chunks.length > 1) {
          continue;
        }

        expect(sqlite.inTransaction).toBe(false);

        const writer = new Database(databasePath);

        try {
          writer.run("PRAGMA busy_timeout = 5000;");
          writer
            .query(
              `insert into applications (id, user_id, posting_id, company_id, company_name, company_name_norm,
                 posting_title, posting_url, origin, status, created_at, updated_at)
               values (?, ?, 'posting-late', 'company-late', 'Late Cloud', 'late cloud',
                 'Staff Engineer', 'https://boards.example/jobs/late', 'auto', 'ready', ?, ?)`,
            )
            .run(LATE_APPLICATION_ID, USER_ID, NOW + 999, NOW + 999);
        } finally {
          writer.close();
        }
      }

      const exported = exportedSchema.parse(JSON.parse(chunks.join("")));

      expect(sqlite.inTransaction).toBe(false);
      expect(exported).toHaveLength(SEEDED_APPLICATIONS + 1);
      expect(exported.at(-1)?.id).toBe(LATE_APPLICATION_ID);
    } finally {
      sqlite.close();
    }
  });
});
