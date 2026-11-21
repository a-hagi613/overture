import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { RevealSession } from "../platform/audit/reveal.ts";

import {
  applications,
  companies,
  facts,
  postings,
  profiles,
  resumes,
  targets,
  users,
} from "../platform/db/schema.ts";

const EEO_FACT_KEYS = [
  "eeo_gender",
  "eeo_race_ethnicity",
  "eeo_veteran",
  "eeo_disability",
] as const;

const EEO_FIELDS = ["gender", "ethnicity", "veteran", "disability"] as const;

type EeoField = (typeof EEO_FIELDS)[number];

const stringListSchema = z.array(z.string());

function readStringList(value: string) {
  try {
    const parsed = stringListSchema.safeParse(JSON.parse(value));

    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

type EeoFieldLookup = (key: string) => EeoField | null;

const eeoFieldOf: EeoFieldLookup = (key) => {
  switch (key) {
    case "eeo_gender": {
      return "gender";
    }

    case "eeo_race_ethnicity": {
      return "ethnicity";
    }

    case "eeo_veteran": {
      return "veteran";
    }

    case "eeo_disability": {
      return "disability";
    }

    default: {
      return null;
    }
  }
};

function emptyTally() {
  const tally = new Map<EeoField, Map<string, number>>();

  for (const field of EEO_FIELDS) {
    tally.set(field, new Map<string, number>());
  }

  return tally;
}

function aggregateOf(counts: Map<string, number>) {
  return [...counts.entries()]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));
}

export async function readEeoAggregates(db: AppDatabase, personal: PersonalCrypto) {
  const rows = db
    .select()
    .from(facts)
    .where(inArray(facts.key, [...EEO_FACT_KEYS]))
    .all();

  const tally = emptyTally();

  const opened = await Promise.all(
    rows.map(async (row) => {
      const field = eeoFieldOf(row.key);

      if (field === null) {
        return null;
      }

      const value = await personal
        .openFor(row.userId, { column: "value_enc", rowId: row.id, table: "facts" }, row.valueEnc)
        .catch(() => null);

      return value === null ? null : { field, value };
    }),
  );

  for (const entry of opened) {
    if (entry === null) {
      continue;
    }

    const counts = tally.get(entry.field) ?? new Map<string, number>();

    counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
    tally.set(entry.field, counts);
  }

  return {
    gender: aggregateOf(tally.get("gender") ?? new Map<string, number>()),
    ethnicity: aggregateOf(tally.get("ethnicity") ?? new Map<string, number>()),
    veteran: aggregateOf(tally.get("veteran") ?? new Map<string, number>()),
    disability: aggregateOf(tally.get("disability") ?? new Map<string, number>()),
  };
}

export async function readRevealedFacts(db: AppDatabase, personal: PersonalCrypto, userId: string) {
  const rows = db
    .select()
    .from(facts)
    .where(eq(facts.userId, userId))
    .orderBy(facts.key, facts.scope)
    .all();

  const revealed = await Promise.all(
    rows.map(async (row) => {
      if (eeoFieldOf(row.key) !== null) {
        return null;
      }

      const value = await personal
        .openFor(row.userId, { column: "value_enc", rowId: row.id, table: "facts" }, row.valueEnc)
        .catch(() => null);

      if (value === null) {
        return null;
      }

      return {
        key: row.key,
        scope: row.scope,
        value,
        source: row.source,
        confirmed: row.confirmed,
        revision: row.revision,
      };
    }),
  );

  return revealed.flatMap((entry) => (entry === null ? [] : [entry]));
}

async function resumeView(db: AppDatabase, personal: PersonalCrypto, userId: string) {
  const row = db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
    .get();

  if (row === undefined) {
    return null;
  }

  const filename = await personal
    .openFor(
      row.userId,
      { column: "filename_enc", rowId: row.id, table: "resumes" },
      row.filenameEnc,
    )
    .catch(() => null);

  return {
    bytes: row.bytes,
    filename,
    pages: row.pages,
    uploadedAt: row.uploadedAt.getTime(),
  };
}

function boardRows(db: AppDatabase, userId: string) {
  return db
    .select({
      company: companies.name,
      id: applications.id,
      sentAt: applications.sentAt,
      stage: applications.stage,
      status: applications.status,
      title: postings.title,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .leftJoin(companies, eq(companies.id, applications.companyId))
    .leftJoin(postings, eq(postings.id, applications.postingId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt))
    .limit(100)
    .all()
    .map((row) => ({
      company: row.company ?? "",
      id: row.id,
      sentAt: row.sentAt,
      stage: row.stage,
      status: row.status,
      title: row.title ?? "",
      updatedAt: row.updatedAt,
    }));
}

export async function buildActAsView(
  db: AppDatabase,
  clock: Clock,
  personal: PersonalCrypto,
  targetUserId: string,
  reveal: RevealSession,
) {
  const user = db.select().from(users).where(eq(users.id, targetUserId)).get();

  if (user === undefined) {
    return null;
  }

  const profile = db.select().from(profiles).where(eq(profiles.userId, targetUserId)).get();
  const targetRow = db.select().from(targets).where(eq(targets.userId, targetUserId)).get();
  const board = boardRows(db, targetUserId);

  return {
    now: clock.now(),
    reveal: {
      id: reveal.id,
      openedAt: reveal.openedAt,
      expiresAt: reveal.expiresAt,
      reason: reveal.reason,
      remainingMs: Math.max(0, reveal.expiresAt - clock.now()),
      targetUserId: reveal.targetUserId,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      status: user.suspendedAt === null ? "active" : "suspended",
      createdAt: user.createdAt.getTime(),
    },
    profile:
      profile === undefined
        ? null
        : {
            consentAt: profile.consentAt?.getTime() ?? null,
            consentVersion: profile.consentVersion,
            languages: readStringList(profile.languages),
            onboardedAt: profile.onboardedAt?.getTime() ?? null,
            onboardingStep: profile.onboardingStep,
            pauseReason: profile.pauseReason,
            running: profile.running,
            timezone: profile.timezone,
          },
    targets:
      targetRow === undefined
        ? null
        : {
            employmentTypes: readStringList(targetRow.employmentTypes),
            locations: readStringList(targetRow.locations),
            roles: readStringList(targetRow.roles),
            seniorities: readStringList(targetRow.seniorities),
            workplaces: readStringList(targetRow.workplaces),
          },
    resume: await resumeView(db, personal, targetUserId),
    facts: await readRevealedFacts(db, personal, targetUserId),
    eeoAggregates: await readEeoAggregates(db, personal),
    board,
    counts: {
      applications: board.length,
      ready: board.filter((row) => row.status === "ready" || row.status === "approved").length,
      sent: board.filter((row) => row.status === "sent").length,
    },
  };
}
