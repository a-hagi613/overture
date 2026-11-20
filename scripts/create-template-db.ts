import { mkdirSync, rmSync } from "node:fs";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { indexPosting } from "../src/server/platform/search/search.ts";
import { companies, companyBoards, postings } from "../src/server/platform/db/schema.ts";

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

const DEPARTMENTS = [
  "Engineering",
  "Data",
  "Product",
  "Security",
  "Infrastructure",
  "Support",
];

function slugFor(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
}

export function seedTemplateCatalog(db: ReturnType<typeof openDatabase>["db"]) {
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

      db.insert(postings)
        .values({
          id: postingId,
          boardId,
          companyId,
          ats: "greenhouse",
          atsJobId: String(900_000 + companyIndex * 100 + jobIndex),
          url: `https://jobs.example/${String(companyIndex)}/${String(jobIndex)}`,
          applyUrlNorm: `https://jobs.example/${String(companyIndex)}/${String(jobIndex)}`,
          title,
          titleNorm,
          department,
          locationRaw: location,
          countryCode: null,
          region: null,
          city: null,
          workplace: "unknown",
          employmentType: "full_time",
          language: "en",
          postedAt: now - jobIndex * 3_600_000,
          salaryMinMinor: null,
          salaryMaxMinor: null,
          salaryCurrency: null,
          salaryPeriod: null,
          sourceUpdatedAt: now - jobIndex * 3_600_000,
          firstSeenAt: now,
          lastSeenAt: now,
          missingPolls: 0,
          closedAt: null,
          dedupeKey: `${companyId}|${titleNorm}||`,
          descriptionGz: null,
          descriptionHash: null,
        })
        .onConflictDoNothing()
        .run();

      indexPosting(db, {
        id: postingId,
        title: titleNorm,
        company: name,
        location,
        department,
      });
    }
  }
}

export function createTemplateDatabase(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }

  mkdirSync("test/e2e/.tmp", { recursive: true });

  const { db, sqlite } = openDatabase(path);

  migrateDatabase(db, "drizzle");
  seedTemplateCatalog(db);
  sqlite.close();
}

if (import.meta.main) {
  const path = process.argv[2] ?? "test/e2e/.tmp/template.db";

  createTemplateDatabase(path);
  process.stdout.write(`template database ready at ${path}\n`);
}
