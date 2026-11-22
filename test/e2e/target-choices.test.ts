import { expect, test } from "./app.fixture.ts";
import { openCatalogDatabase, openDatabase } from "../../src/server/platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import {
  createTargetChoicesCache,
  targetChoices,
} from "../../src/server/profile/target-choices.ts";

const NOW = 1_795_000_000_000;

function setup() {
  const { db, sqlite } = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  migrateDatabase(db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");
  catalog.sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('c', 'Co', 'co', 1)",
  );

  catalog.sqlite.run(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES ('b', 'c', 'greenhouse', 't', 'us', 'active', 'import', 1)",
  );

  function addPosting(id: string, input: { closed: boolean; role: string }) {
    catalog.sqlite
      .prepare(
        `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
          location_raw, country_code, city, language, workplace, employment_type, first_seen_at, last_seen_at,
          closed_at, dedupe_key)
         VALUES (?, 'b', 'c', 'greenhouse', ?, ?, ?, ?, ?, 'Berlin', 'DE', 'Berlin', 'en', 'remote', 'full_time', ?, ?, ?, ?)`,
      )
      .run(
        id,
        id,
        `https://example.test/${id}`,
        `https://example.test/${id}`,
        input.role,
        input.role.toLowerCase(),
        NOW,
        NOW,
        input.closed ? NOW : null,
        id,
      );

    catalog.sqlite
      .prepare(
        "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'role', ?, 'rules')",
      )
      .run(id, input.role);
  }

  return { addPosting, catalogDb: catalog.db, catalogSqlite: catalog.sqlite, db, sqlite };
}

test("role choices: closed Postings with more tags never crowd an open role out of the list", () => {
  const { addPosting, catalogDb } = setup();

  for (let index = 0; index < 90; index += 1) {
    for (let copy = 0; copy < 3; copy += 1) {
      addPosting(`closed-${String(index)}-${String(copy)}`, {
        closed: true,
        role: `Closed role ${String(index).padStart(2, "0")}`,
      });
    }
  }

  addPosting("open-1", { closed: false, role: "Open role" });

  expect(targetChoices(catalogDb).roles).toEqual(["Open role"]);
});

test("role choices: ranks open roles by how many open Postings carry them", () => {
  const { addPosting, catalogDb } = setup();

  addPosting("a1", { closed: false, role: "Rare" });
  addPosting("b1", { closed: false, role: "Common" });
  addPosting("b2", { closed: false, role: "Common" });
  addPosting("c1", { closed: true, role: "Common" });
  addPosting("c2", { closed: true, role: "Rare" });
  addPosting("c3", { closed: true, role: "Rare" });
  addPosting("c4", { closed: true, role: "Rare" });

  expect(targetChoices(catalogDb).roles).toEqual(["Common", "Rare"]);
});

test("a failed background refresh is reported, not swallowed", async () => {
  const { catalogDb, catalogSqlite } = setup();
  const failures: unknown[] = [];
  let reported = Promise.withResolvers<undefined>();

  const cache = createTargetChoicesCache({
    catalogDb,
    now: () => NOW,
    onError: (cause) => {
      failures.push(cause);
      reported.resolve(undefined);
    },
    staleMs: 1000,
  });

  catalogSqlite.close();
  cache.warm();
  await reported.promise;

  expect(failures).toHaveLength(1);

  reported = Promise.withResolvers<undefined>();
  cache.warm();
  await reported.promise;

  expect(failures).toHaveLength(2);
});
