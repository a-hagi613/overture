import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { FactRecord } from "./facts.ts";

import { createQuestionCatalog } from "../catalog/questions.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { users } from "../platform/db/schema.ts";
import { createFactService } from "./facts.ts";
import { createPersonalCrypto } from "./personal-crypto.ts";
import { parseV1Export } from "./v1-export.ts";
import { importV1Facts, mapAnswerBankEntry } from "./v1-import.ts";

const fixture = readFileSync(new URL("v1-export.fixture.json", import.meta.url), "utf8");

const NOW = "2026-01-05T10:00:00.000Z";

function exportedFile() {
  return parseV1Export(fixture);
}

function freshImport() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      id: "user-1",
      name: "Example Owner",
      email: "owner@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const personal = createPersonalCrypto(db, new Uint8Array(32).fill(7), 1);
  const catalog = createQuestionCatalog({ db, clock });
  const facts = createFactService({ db, clock, personal });

  return { catalog, clock, db, facts, personal, userId: "user-1" };
}

function factIndex(records: readonly FactRecord[]) {
  return new Map(records.map((record) => [`${record.key}\u0000${record.scope}`, record] as const));
}

describe("mapping an answer-bank entry", () => {
  test("takes the email address from the row's note", () => {
    expect(
      mapAnswerBankEntry({
        key: "email",
        group: "Identity and contact",
        question: "Email on application forms",
        value: "person@example.com (contact address)",
        kind: "fact",
        updatedAt: NOW,
        ownerEdited: true,
      }),
    ).toStrictEqual({
      kind: "fact",
      key: "email",
      scope: "",
      value: "person@example.com",
      merge: false,
    });
  });

  test("matches an entry whose key changed by its question", () => {
    expect(
      mapAnswerBankEntry({
        key: "email_on_application_forms",
        group: "Identity and contact",
        question: "Email on application forms",
        value: "person@example.com",
        kind: "fact",
        updatedAt: NOW,
        ownerEdited: true,
      }),
    ).toStrictEqual({
      kind: "fact",
      key: "email",
      scope: "",
      value: "person@example.com",
      merge: false,
    });
  });

  test("keeps a country-scoped work authorisation answer in its country", () => {
    expect(
      mapAnswerBankEntry({
        key: "work_auth_ca",
        group: "Work authorization",
        question: "Authorized to work in Canada",
        value: "Yes",
        kind: "fact",
        updatedAt: NOW,
        ownerEdited: true,
      }),
    ).toStrictEqual({ kind: "fact", key: "work_auth", scope: "CA", value: "Yes", merge: false });
  });

  test("lists an entry with no catalog key as skipped", () => {
    expect(
      mapAnswerBankEntry({
        key: "pronouns",
        group: "Identity and contact",
        question: "Pronouns",
        value: "they/them",
        kind: "fact",
        updatedAt: NOW,
        ownerEdited: true,
      }),
    ).toStrictEqual({ kind: "skip", reason: "no_catalog_key" });
  });

  test("lists a value the field type refuses as invalid", () => {
    expect(
      mapAnswerBankEntry({
        key: "example_phone",
        group: "Identity and contact",
        question: "Phone",
        value: "call me",
        kind: "fact",
        updatedAt: NOW,
        ownerEdited: true,
      }),
    ).toStrictEqual({ kind: "skip", reason: "invalid_value" });
  });

  test("lists a structured value as invalid for a text fact", () => {
    expect(
      mapAnswerBankEntry({
        key: "legal_name",
        group: "Identity and contact",
        question: "Legal first / last name",
        value: { first: "Example", last: "Person" },
        kind: "fact",
        updatedAt: NOW,
        ownerEdited: true,
      }),
    ).toStrictEqual({ kind: "skip", reason: "invalid_value" });
  });
});

describe("importing the exported v1 facts", () => {
  test("imports the answer bank as encrypted facts with source import", async () => {
    const { catalog, clock, db, facts, personal, userId } = freshImport();

    const report = await importV1Facts({
      db,
      clock,
      personal,
      catalog,
      userId,
      exported: exportedFile(),
    });

    const records = await facts.list(userId);
    const byKey = factIndex(records);

    expect(byKey.get("email\u0000")?.value).toBe("person@example.com");
    expect(byKey.get("email\u0000")?.source).toBe("import");
    expect(byKey.get("legal_name\u0000")?.value).toBe("Example Person");
    expect(byKey.get("phone\u0000")?.value).toBe("+1 555 010 0199");
    expect(byKey.get("current_city\u0000")?.value).toBe("Example City, ON");
    expect(byKey.get("website_url\u0000")?.value).toBe("https://example.test/portfolio");
    expect(byKey.get("work_auth\u0000CA")?.value).toBe("Yes");
    expect(byKey.get("work_auth\u0000US")?.value).toBe("Yes");
    expect(byKey.get("sponsorship_required\u0000")?.value).toBe("No");
    expect(byKey.get("security_clearance\u0000")?.value).toBe("None");
    expect(byKey.get("years_total\u0000")?.value).toBe("7");
    expect(byKey.get("eeo_gender\u0000")?.value).toBe("Example gender");
    expect(byKey.get("eeo_disability\u0000")?.value).toBe("No");
    expect(byKey.get("certifications\u0000")?.value).toBe(
      "Example Certificate (EX-1), Another Example Certificate",
    );
    expect(byKey.get("skills\u0000")?.value).toBe(
      "Example Skill (3 years), Another Example Skill (1 year)",
    );
    expect(byKey.has("pronouns\u0000")).toBe(false);
    expect(byKey.has("salary_floor\u0000")).toBe(false);
    expect(byKey.has("how_did_you_hear_about_us\u0000")).toBe(false);

    expect(report.counts.imported).toBe(records.length);
    expect(report.skipped).toContainEqual({
      key: null,
      scope: "",
      from: "bank:example_phone",
      reason: "invalid_value",
    });
    expect(report.skipped).toContainEqual({
      key: null,
      scope: "",
      from: "bank:salary_floor",
      reason: "no_catalog_key",
    });
    expect(report.skipped).toContainEqual({
      key: null,
      scope: "",
      from: "bank:pronouns",
      reason: "no_catalog_key",
    });
    expect(report.skipped).toContainEqual({
      key: null,
      scope: "",
      from: "achievement:0",
      reason: "no_catalog_key",
    });
    expect(report.notImported).toStrictEqual([
      { section: "answer aliases", rows: 1 },
      { section: "answer settings", rows: 1 },
    ]);
  });

  test("never prints a value in the report", async () => {
    const { catalog, clock, db, personal, userId } = freshImport();

    const report = await importV1Facts({
      db,
      clock,
      personal,
      catalog,
      userId,
      exported: exportedFile(),
    });

    const printed = JSON.stringify(report);

    expect(printed).not.toContain("person@example.com");
    expect(printed).not.toContain("Example Person");
    expect(printed).not.toContain("they/them");
    expect(printed).not.toContain("Example City");
  });

  test("imports a learned answer as the question's Tier 3 fact", async () => {
    const { catalog, clock, db, facts, personal, userId } = freshImport();

    const pronounQuestionId = catalog.findOrCreate({
      text: "Example question about pronouns",
      fieldType: "text",
      options: [],
      companyNames: [],
    }).id;

    catalog.findOrCreate({
      text: "Example years question",
      fieldType: "number",
      options: [],
      companyNames: [],
    });

    const report = await importV1Facts({
      db,
      clock,
      personal,
      catalog,
      userId,
      exported: exportedFile(),
    });

    const learned = factIndex(await facts.list(userId)).get(`q:${pronounQuestionId}\u0000`);

    expect(learned?.value).toBe("they/them");
    expect(learned?.source).toBe("import");
    expect(catalog.byId(pronounQuestionId)).toMatchObject({
      answerKind: "fact",
      factKey: `q:${pronounQuestionId}`,
      mappedBy: "owner",
    });
    expect(report.questionMappings).toBe(1);
    expect(report.skipped).toContainEqual({
      key: null,
      scope: "",
      from: "learned:example years question",
      reason: "invalid_value",
    });
    expect(report.skipped).toContainEqual({
      key: null,
      scope: "",
      from: "learned:a question the catalog has never seen",
      reason: "unknown_question",
    });
  });

  test("re-running changes nothing and duplicates no row", async () => {
    const { catalog, clock, db, facts, personal, userId } = freshImport();

    const exported = exportedFile();

    await importV1Facts({ db, clock, personal, catalog, userId, exported });

    const before = await facts.list(userId);

    const report = await importV1Facts({ db, clock, personal, catalog, userId, exported });
    const after = await facts.list(userId);

    expect(report.counts.imported).toBe(0);
    expect(report.counts.updated).toBe(0);
    expect(report.counts.unchanged).toBe(before.length);
    expect(after).toStrictEqual(before);
  });

  test("leaves a fact the owner typed or answered in a review alone", async () => {
    const { catalog, clock, db, facts, personal, userId } = freshImport();

    await facts.save(userId, "legal_name", "Name Typed By The Owner");
    await facts.saveFromReview(userId, "current_city", "City From A Review");

    const report = await importV1Facts({
      db,
      clock,
      personal,
      catalog,
      userId,
      exported: exportedFile(),
    });

    const byKey = factIndex(await facts.list(userId));

    expect(byKey.get("legal_name\u0000")?.value).toBe("Name Typed By The Owner");
    expect(byKey.get("legal_name\u0000")?.source).toBe("user");
    expect(byKey.get("current_city\u0000")?.value).toBe("City From A Review");
    expect(byKey.get("current_city\u0000")?.source).toBe("review");
    expect(report.skipped).toContainEqual({
      key: "legal_name",
      scope: "",
      from: "bank:legal_name",
      reason: "kept_user_fact",
    });
    expect(report.skipped).toContainEqual({
      key: "current_city",
      scope: "",
      from: "bank:current_city",
      reason: "kept_user_fact",
    });
  });
});
