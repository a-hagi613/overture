import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { retryWhenBusy } from "../platform/db/busy.ts";
import { skipCompanies } from "../platform/db/schema.ts";
import { companies } from "../platform/db/catalog-schema.ts";
import { skipCompaniesInputSchema } from "../../shared/targets.ts";

const LEGAL_SUFFIXES = new Set([
  "inc",
  "ltd",
  "llc",
  "corp",
  "co",
  "gmbh",
  "sa",
  "plc",
  "limited",
  "corporation",
  "incorporated",
  "company",
]);

const storedSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  reason: z.enum(["current_employer", "user"]),
});

export type SkipCompany = z.infer<typeof storedSchema>;

export function normalizeCompanyName(raw: string) {
  const folded = raw
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

  const words = folded.split(" ").filter((word) => word.length > 0);

  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1) ?? "")) {
    words.pop();
  }

  return words.join(" ");
}

export function createSkipCompanyService(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
}) {
  const { db, catalogDb, clock } = deps;

  async function list(userId: string) {
    const rows = await db
      .select({
        id: skipCompanies.id,
        name: skipCompanies.name,
        domain: skipCompanies.domain,
        reason: skipCompanies.reason,
      })
      .from(skipCompanies)
      .where(eq(skipCompanies.userId, userId));

    return rows
      .map((row) => storedSchema.parse(row))
      .toSorted((left, right) => {
        if (left.reason === right.reason) {
          return 0;
        }

        return left.reason === "current_employer" ? -1 : 1;
      });
  }

  function companyIdFor(nameNorm: string) {
    return (
      catalogDb
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.nameNorm, nameNorm))
        .get()?.id ?? null
    );
  }

  async function replaceUserCompanies(
    userId: string,
    input: z.input<typeof skipCompaniesInputSchema>,
  ) {
    const { companies: rows } = skipCompaniesInputSchema.parse(input);

    await retryWhenBusy(() => {
      db.delete(skipCompanies)
        .where(and(eq(skipCompanies.userId, userId), eq(skipCompanies.reason, "user")))
        .run();

      db.transaction((tx) => {
        for (const row of rows) {
          const nameNorm = normalizeCompanyName(row.name);

          if (nameNorm === "") {
            continue;
          }

          tx.insert(skipCompanies)
            .values({
              id: crypto.randomUUID(),
              userId,
              companyId: companyIdFor(nameNorm),
              name: row.name,
              nameNorm,
              domain: row.domain,
              reason: "user",
              createdAt: new Date(clock.now()),
            })
            .onConflictDoNothing()
            .run();
        }
      });
    }, "profile.skip-companies");

    return list(userId);
  }

  async function setCurrentEmployer(userId: string, name: string) {
    const nameNorm = normalizeCompanyName(name);

    if (nameNorm === "") {
      return;
    }

    await retryWhenBusy(() => {
      db.delete(skipCompanies)
        .where(
          and(
            eq(skipCompanies.userId, userId),
            eq(skipCompanies.reason, "current_employer"),
            ne(skipCompanies.nameNorm, nameNorm),
          ),
        )
        .run();

      db.insert(skipCompanies)
        .values({
          id: crypto.randomUUID(),
          userId,
          companyId: companyIdFor(nameNorm),
          name,
          nameNorm,
          domain: null,
          reason: "current_employer",
          createdAt: new Date(clock.now()),
        })
        .onConflictDoUpdate({
          target: [skipCompanies.userId, skipCompanies.nameNorm],
          set: { name, companyId: companyIdFor(nameNorm), reason: "current_employer" },
        })
        .run();
    }, "profile.skip-companies.current-employer");
  }

  return { list, replaceUserCompanies, setCurrentEmployer };
}
