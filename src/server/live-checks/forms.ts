import { and, asc, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { LiveCheckResult } from "./types.ts";

import { ATS_NAMES, captureFixtures } from "../fixtures/capture.ts";
import { postings } from "../platform/db/schema.ts";
import { previousCheckDetail } from "./store.ts";
import { failedResult } from "./types.ts";

export interface FormsCheckDeps {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  providers: BrowserProviderRegistry | null;
}

function postingFor(db: AppDatabase, ats: (typeof ATS_NAMES)[number]) {
  return db
    .select({ id: postings.id, url: postings.url, applyUrl: postings.applyUrl })
    .from(postings)
    .where(and(eq(postings.ats, ats), isNull(postings.closedAt)))
    .orderBy(asc(postings.firstSeenAt), asc(postings.id))
    .limit(1)
    .get();
}

async function runOneAts(deps: FormsCheckDeps, ats: (typeof ATS_NAMES)[number]) {
  const startedAt = deps.clock.now();
  const posting = postingFor(deps.db, ats);

  if (posting === undefined) {
    return failedResult(`forms.${ats}`, startedAt, "no open posting for this ATS in the catalog");
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
