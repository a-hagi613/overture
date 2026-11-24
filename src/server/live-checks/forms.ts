import { and, asc, eq, isNull } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { LiveCheckResult } from "./types.ts";
import type { PlainFormReader } from "../pipeline/form-read.ts";

import { ATS_NAMES, captureFixtures } from "../fixtures/capture.ts";
import { postings } from "../platform/db/catalog-schema.ts";

import { env } from "../config/env.ts";
import { createPlainFormReader, isLoginWallRead } from "../pipeline/form-read.ts";
import { isKillSwitchEnabled } from "../platform/settings/index.ts";
import { previousCheckDetail } from "./store.ts";
import { failedResult, skippedResult } from "./types.ts";

export interface FormsCheckDeps {
  catalogDb: CatalogDatabase;
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  providers: BrowserProviderRegistry | null;
  plainFormReader?: PlainFormReader;
}

function postingFor(db: CatalogDatabase, ats: (typeof ATS_NAMES)[number]) {
  return db
    .select({
      id: postings.id,
      url: postings.url,
      applyUrl: postings.applyUrl,
      atsJobId: postings.atsJobId,
    })
    .from(postings)
    .where(and(eq(postings.ats, ats), isNull(postings.closedAt)))
    .orderBy(asc(postings.firstSeenAt), asc(postings.id))
    .limit(1)
    .get();
}

async function runPersonioCheck(
  deps: FormsCheckDeps,
  startedAt: number,
  posting: NonNullable<ReturnType<typeof postingFor>>,
) {
  const reader = deps.plainFormReader ?? createPlainFormReader({ environment: env.NODE_ENV });

  const read = await reader.read({
    applyUrl: posting.applyUrl,
    ats: "personio",
    atsJobId: posting.atsJobId,
    boardToken: "",
    region: "us",
    url: posting.url,
  });

  if (isLoginWallRead(read)) {
    return failedResult(
      "forms.personio",
      startedAt,
      `a mandatory login gate stopped the read (${read.evidence.markers.join(", ")}); no form was read`,
      deps.clock.now() - startedAt,
    );
  }

  if (read === null || read.questions.length === 0) {
    return failedResult(
      "forms.personio",
      startedAt,
      "the Personio form could not be read over plain HTTP",
      deps.clock.now() - startedAt,
    );
  }

  const previous = previousCheckDetail(deps.db, "forms.personio");
  const previousSignature = previous?.["formSignature"];
  const changed = previousSignature !== undefined && previousSignature !== read.formSignature;

  return {
    check: "forms.personio",
    ok: true,
    startedAt,
    durationMs: deps.clock.now() - startedAt,
    detail: {
      ats: "personio",
      changed,
      documents: read.questions.filter((question) => question.fieldType === "file").length,
      formSignature: read.formSignature,
      path: read.path,
      postingId: posting.id,
      questions: read.questions.length,
      required: read.questions.filter((question) => question.required).length,
      url: posting.applyUrl ?? posting.url,
    },
  } satisfies LiveCheckResult;
}

async function runOneAts(deps: FormsCheckDeps, ats: (typeof ATS_NAMES)[number]) {
  const startedAt = deps.clock.now();
  const posting = postingFor(deps.catalogDb, ats);

  if (posting === undefined) {
    return failedResult(`forms.${ats}`, startedAt, "no open posting for this ATS in the catalog");
  }

  if (ats === "personio") {
    if (isKillSwitchEnabled(deps.db, "ats", "personio")) {
      return skippedResult(
        "forms.personio",
        startedAt,
        "ats.personio kill switch engaged; the probe enables it before the daily check runs",
      );
    }

    try {
      return await runPersonioCheck(deps, startedAt, posting);
    } catch (error) {
      return failedResult(
        `forms.personio`,
        startedAt,
        error instanceof Error ? error.message : String(error),
        deps.clock.now() - startedAt,
      );
    }
  }

  if (deps.providers === null) {
    return failedResult(`forms.${ats}`, startedAt, "browser_provider_unconfigured");
  }

  const url = posting.applyUrl ?? posting.url;

  try {
    const [captured] = await captureFixtures(
      { clock: deps.clock, objects: deps.objects, providers: deps.providers },
      { ats, applyUrls: [url] },
    );

    if (captured === undefined) {
      return failedResult(`forms.${ats}`, startedAt, "capture returned no fixture");
    }

    const previous = previousCheckDetail(deps.db, `forms.${ats}`);

    const previousSignature = previous?.["formSignature"];

    const changed = previousSignature !== undefined && previousSignature !== captured.formSignature;

    return {
      check: `forms.${ats}`,
      ok: true,
      startedAt,
      durationMs: deps.clock.now() - startedAt,
      detail: {
        ats,
        assets: captured.assets,
        changed,
        formSignature: captured.formSignature,
        objectKey: captured.objectKey,
        postingId: posting.id,
        url,
      },
    } satisfies LiveCheckResult;
  } catch (error) {
    return failedResult(
      `forms.${ats}`,
      startedAt,
      error instanceof Error ? error.message : String(error),
      deps.clock.now() - startedAt,
    );
  }
}

export async function runFormsCheck(deps: FormsCheckDeps) {
  const runFrom: (index: number, results: LiveCheckResult[]) => Promise<LiveCheckResult[]> = async (
    index,
    results,
  ) => {
    const ats = ATS_NAMES[index];

    if (ats === undefined) {
      return results;
    }

    results.push(await runOneAts(deps, ats));

    return runFrom(index + 1, results);
  };

  return runFrom(0, []);
}
