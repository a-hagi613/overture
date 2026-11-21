import { desc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { consentVersions, profiles } from "../platform/db/schema.ts";
import { INITIAL_CONSENT_VERSION } from "../../shared/consent.ts";

function nextVersion(latest: string) {
  const current = Number(latest);

  if (!Number.isInteger(current) || current < 1) {
    throw new Error(`the consent version "${latest}" is not a positive whole number`);
  }

  return String(current + 1);
}

export function createConsentService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  const newestFirst = [
    desc(consentVersions.publishedAt),
    sql`CAST(${consentVersions.version} AS INTEGER) DESC`,
  ];

  function list() {
    return db
      .select()
      .from(consentVersions)
      .orderBy(...newestFirst)
      .all();
  }

  function current() {
    return list().at(0) ?? null;
  }

  function publish(text: string) {
    const latest = list().at(0);
    const version = latest === undefined ? INITIAL_CONSENT_VERSION : nextVersion(latest.version);

    db.insert(consentVersions)
      .values({ publishedAt: new Date(clock.now()), text, version })
      .run();

    const published = db
      .select()
      .from(consentVersions)
      .where(eq(consentVersions.version, version))
      .get();

    if (published === undefined) {
      throw new Error("the published consent version could not be read back");
    }

    return published;
  }

  function read(userId: string) {
    const latest = current();

    if (latest === null) {
      throw new Error("no consent version has been published");
    }

    const profile = db
      .select({ consentAt: profiles.consentAt, consentVersion: profiles.consentVersion })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    if (profile === undefined) {
      return { accepted: null, current: latest };
    }

    if (profile.consentAt === null) {
      return { accepted: null, current: latest };
    }

    return {
      accepted: { at: profile.consentAt, version: profile.consentVersion },
      current: latest,
    };
  }

  function accept(userId: string, version: string) {
    const latest = current();

    if (latest === null) {
      return { error: "no_version" as const };
    }

    if (latest.version !== version) {
      return { error: "version_changed" as const, current: latest };
    }

    const at = new Date(clock.now());

    db.insert(profiles)
      .values({
        consentAt: at,
        consentVersion: version,
        createdAt: at,
        updatedAt: at,
        userId,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { consentAt: at, consentVersion: version, updatedAt: at },
      })
      .run();

    return { accepted: { at, version } };
  }

  return { accept, current, list, publish, read };
}

export type ConsentService = ReturnType<typeof createConsentService>;
