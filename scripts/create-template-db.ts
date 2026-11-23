import { mkdirSync, rmSync } from "node:fs";

import { openCatalogDatabase, openDatabase } from "../src/server/platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { companies, companyBoards, postings } from "../src/server/platform/db/catalog-schema.ts";

import { contentHash } from "../src/server/catalog/content-hash.ts";
import { salaryPeriodForColumn, storePostingTags } from "../src/server/catalog/tag-store.ts";
import { tagPosting } from "../src/server/catalog/tag-rules.ts";

const COMPANY_NAMES = [
  "Northwind Systems",
  "Acme Robotics",
  "Blue Harbor Labs",
  "Copperline Energy",
  "Driftwood Analytics",
  "Ember Freight",
  "Foxglove Health",
  "Granite Bank",
  "Halcyon Games",
  "Ironvale Manufacturing",
  "Juniper Cloud",
  "Kestrel Security",
  "Lumen Media",
  "Marrow Biotech",
  "Nimbus Retail",
  "Oakhaven Insurance",
  "Pinecrest Logistics",
  "Quarry Legal",
  "Riverstone Capital",
  "Summit Directions",
];

const TITLES = [
  "Senior Backend Engineer",
  "Backend Engineer",
  "Frontend Engineer",
  "Full-stack Engineer",
  "Platform Engineer",
  "Site Reliability Engineer",
  "Data Engineer",
  "Machine Learning Engineer",
  "Product Manager",
  "Engineering Manager",
  "Staff Software Engineer",
  "Mobile Engineer",
  "Security Engineer",
  "Database Reliability Engineer",
  "Solutions Architect",
  "Quality Assurance Engineer",
  "Data Scientist",
  "DevOps Engineer",
  "Infrastructure Engineer",
  "Support Engineer",
];

const LOCATIONS = [
  "Toronto, Ontario, Canada",
  "Vancouver, British Columbia, Canada",
  "Remote — Canada",
  "Remote — United States",
  "New York, New York, United States",
  "Austin, Texas, United States",
  "London, United Kingdom",
  "Berlin, Germany",
];

const DEPARTMENTS = ["Engineering", "Data", "Product", "Security", "Infrastructure", "Support"];

const EMPLOYMENT_SIGNALS = ["full-time", "full-time", "contract", "full-time", "part-time"];

function hybridSignal(jobIndex: number) {
  return jobIndex % 3 === 1 ? "This is a hybrid role. " : "";
}

function descriptionFor(title: string, department: string, location: string, jobIndex: number) {
  const employment = EMPLOYMENT_SIGNALS[jobIndex % EMPLOYMENT_SIGNALS.length] ?? "full-time";

  return (
    `${title} on the ${department} team, based in ${location}. ` +
    `${hybridSignal(jobIndex)}This is a ${employment} position.`
  );
}

function slugFor(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
}

/**
 * The catalog template beside an application template: `template-catalog.db` for `template.db`, so the e2e fixtures
 * can copy both into a scratch directory and the server derives the same `catalog.sqlite` path it runs with.
 * @param templatePath The application template path.
 * @returns The catalog template path.
 */
export function templateCatalogPathFor(templatePath: string) {
  return templatePath.endsWith(".db")
    ? `${templatePath.slice(0, -".db".length)}-catalog.db`
    : `${templatePath}-catalog`;
}

export function seedTemplateCatalog(db: ReturnType<typeof openCatalogDatabase>["db"]) {
  const now = 1_795_000_000_000;

  for (const [companyIndex, name] of COMPANY_NAMES.entries()) {
    const companyId = `cmp-${String(companyIndex)}`;

    db.insert(companies)
      .values({
        id: companyId,
        name,
        nameNorm: name.toLowerCase(),
        domain: `${slugFor(name)}.example`,
        industry: null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    const boardId = `board-${String(companyIndex)}`;

    db.insert(companyBoards)
      .values({
        id: boardId,
        companyId,
        ats: "greenhouse",
        boardToken: `${slugFor(name)}-seed`,
        status: "disabled",
        source: "discovered",
        etag: null,
        lastModified: null,
        lastPolledAt: null,
        nextPollAt: null,
        backoffLevel: 0,
        consecutiveErrors: 0,
        notFoundPolls: 0,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    for (const [jobIndex, title] of TITLES.entries()) {
      const postingId = `post-${String(companyIndex)}-${String(jobIndex)}`;
      const location = LOCATIONS[(companyIndex + jobIndex) % LOCATIONS.length] ?? "Remote";
      const departmentValue = DEPARTMENTS[jobIndex % DEPARTMENTS.length] ?? "Engineering";
      const department = departmentValue;
      const titleNorm = title.toLowerCase();
      const descriptionText = descriptionFor(title, department, location, jobIndex);
      const descriptionGz = Buffer.from(Bun.gzipSync(descriptionText));

      const tags = tagPosting({
        title,
        department,
        locationRaw: location,
        workplaceType: null,
        isRemote: null,
        employmentType: null,
        language: "en",
        salary: null,
        descriptionText,
      });

      db.insert(postings)
        .values({
          id: postingId,
          boardId,
          companyId,
          ats: "greenhouse",
          atsJobId: String(900_000 + companyIndex * 100 + jobIndex),
          url: `https://jobs.example/${String(companyIndex)}/${String(jobIndex)}`,
          applyUrl: null,
          applyUrlNorm: `https://jobs.example/${String(companyIndex)}/${String(jobIndex)}`,
          title,
          titleNorm,
          department,
          locationRaw: location,
          countryCode: tags.countryCode,
          region: tags.region,
          city: tags.city,
          language: tags.language,
          workplace: tags.workplace,
          employmentType: tags.employmentType,
          postedAt: now - jobIndex * 3_600_000,
          salaryMinMinor: tags.salaryMinMinor ?? null,
          salaryMaxMinor: tags.salaryMaxMinor ?? null,
          salaryCurrency: tags.salaryCurrency ?? null,
          salaryPeriod:
            tags.salaryPeriod === null ? null : salaryPeriodForColumn(tags.salaryPeriod),
          sourceUpdatedAt: now - jobIndex * 3_600_000,
          firstSeenAt: now,
          lastSeenAt: now,
          missingPolls: 0,
          closedAt: null,
          status: "open",
          applySupported: true,
          dedupeKey: `${companyId}|${titleNorm}|${tags.countryCode ?? ""}|${tags.city ?? ""}`,
          descriptionGz,
          descriptionHash: contentHash(descriptionText),
          tagSource: "rules",
          taggedAt: now,
        })
        .onConflictDoNothing()
        .run();

      storePostingTags(db, postingId, tags, now);
    }
  }
}

export function createTemplateDatabase(path: string) {
  const catalogPath = templateCatalogPathFor(path);

  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
    rmSync(`${catalogPath}${suffix}`, { force: true });
  }

  mkdirSync("test/e2e/.tmp", { recursive: true });

  const { db, sqlite } = openDatabase(path);
  const catalog = openCatalogDatabase(catalogPath);

  migrateDatabase(db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");
  seedTemplateCatalog(catalog.db);
  sqlite.close();
  catalog.sqlite.close();
}

if (import.meta.main) {
  const path = process.argv[2] ?? "test/e2e/.tmp/template.db";

  createTemplateDatabase(path);
  process.stdout.write(`template databases ready at ${path} and ${templateCatalogPathFor(path)}\n`);
}
