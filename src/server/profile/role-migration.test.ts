import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { targets, users } from "../platform/db/schema.ts";
import {
  freehireCategoryForLegacyRole,
  migrateLegacyRoles,
  promoteStoredTargetRoles,
} from "./role-migration.ts";

const NOW = 1_800_000_000_000;

const stringArraySchema = z.array(z.string());

function migrated() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function seedUser(db: ReturnType<typeof migrated>, id: string) {
  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: `${id}@example.test`,
      id,
      name: id,
      updatedAt: new Date(NOW),
    })
    .run();
}

describe("a saved role target becomes a freehire category", () => {
  test("a saved role name reads through the subcategory it used to sit in", () => {
    expect(freehireCategoryForLegacyRole("Backend Engineer")).toBe("backend");
    expect(freehireCategoryForLegacyRole("Frontend Engineer")).toBe("frontend");
    expect(freehireCategoryForLegacyRole("Data Scientist")).toBe("data_science");
    expect(freehireCategoryForLegacyRole("Registered Nurse")).toBe("healthcare");
    expect(freehireCategoryForLegacyRole("Registered Nurse")).toBe("healthcare");
    expect(freehireCategoryForLegacyRole("Technical Writer")).toBe("technical_writing");
    expect(freehireCategoryForLegacyRole("Recruiter / Talent Acquisition")).toBe("recruiting");
  });

  test("a value that already names one freehire category is kept", () => {
    expect(freehireCategoryForLegacyRole("backend")).toBe("backend");
    expect(freehireCategoryForLegacyRole("Marketing")).toBe("marketing");
  });

  test("a value that reaches several freehire categories stays unresolved", () => {
    expect(freehireCategoryForLegacyRole("Data & AI")).toBeNull();
    expect(freehireCategoryForLegacyRole("Product & Design")).toBeNull();
    expect(freehireCategoryForLegacyRole("Night baker")).toBeNull();
  });
});

describe("the saved role list", () => {
  test("splits resolved categories from ambiguous legacy values and keeps free text as a title word", () => {
    expect(
      migrateLegacyRoles([
        "Backend Engineer",
        "Registered Nurse",
        "Data & AI",
        "Night baker",
        "backend",
      ]),
    ).toEqual({
      resolved: ["backend", "healthcare", "Night baker"],
      unresolved: ["Data & AI"],
    });
  });
});

describe("the boot pass", () => {
  test("writes the freehire categories back and keeps the ambiguous value for the person", () => {
    const db = migrated();

    seedUser(db, "user-1");

    db.insert(targets)
      .values({
        locations: JSON.stringify(["city:ca:toronto"]),
        roles: JSON.stringify(["Backend Engineer", "Data & AI", "Night baker"]),
        updatedAt: new Date(NOW),
        userId: "user-1",
        version: 1,
      })
      .run();

    expect(promoteStoredTargetRoles(db)).toBe(1);

    const row = db.select().from(targets).where(eq(targets.userId, "user-1")).get();

    expect(stringArraySchema.parse(JSON.parse(row?.roles ?? "[]"))).toEqual([
      "backend",
      "Night baker",
    ]);
    expect(stringArraySchema.parse(JSON.parse(row?.unresolvedRoles ?? "[]"))).toEqual([
      "Data & AI",
    ]);
  });

  test("a second run writes nothing", () => {
    const db = migrated();

    seedUser(db, "user-1");

    db.insert(targets)
      .values({
        locations: JSON.stringify(["city:ca:toronto"]),
        roles: JSON.stringify(["Backend Engineer"]),
        updatedAt: new Date(NOW),
        userId: "user-1",
        version: 1,
      })
      .run();

    expect(promoteStoredTargetRoles(db)).toBe(1);
    expect(promoteStoredTargetRoles(db)).toBe(0);
  });
});
