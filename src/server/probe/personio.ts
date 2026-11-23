import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { isFixtureHost } from "../../shared/live-service-hosts.ts";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PlainFormReader } from "../pipeline/form-read.ts";

import { mapQuestionByRules } from "../catalog/question-rules.ts";
import { PERSONIO_LIMITS } from "../catalog/personio-feed.ts";
import { limiterFor } from "../catalog/rate-limiter.ts";
import { env } from "../config/env.ts";
import { recordLiveCheckResult } from "../live-checks/store.ts";
import { postings } from "../platform/db/catalog-schema.ts";

import { createPlainFormReader, isLoginWallRead } from "../pipeline/form-read.ts";

export const PERSONIO_PROBE_JOB_KIND = "probe.personio";

export const PERSONIO_PROBE_LIMIT = 20;

const PERSONIO_APPLY_HOST = /^(?:[a-z0-9-]+\.jobs\.personio\.(?:com|de))$/iu;

/**
 * A probe URL must point at a Personio career site. Loopback fixture hosts are
 * accepted only outside production (ADR 0016); anything else is refused before
 * the job is queued.
 *
 * @param raw the owner-supplied apply URL
 * @param environment the process environment
 * @returns whether the URL may be probed
 */
export function isPersonioProbeUrl(raw: string, environment: string) {
  try {
    const parsed = new URL(raw);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    if (isFixtureHost(parsed.hostname)) {
      return environment !== "production";
    }

    return parsed.protocol === "https:" && PERSONIO_APPLY_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export const personioProbePayloadSchema = z.object({
  urls: z
    .array(z.url().refine((url) => isPersonioProbeUrl(url, env.NODE_ENV)))
    .min(1)
    .max(20)
    .optional(),
});

export const PERSONIO_PROBE_OUTCOMES = [
  "readable",
  "needs_review",
  "unreadable",
  "unsupported",
] as const;

export type PersonioProbeOutcome = (typeof PERSONIO_PROBE_OUTCOMES)[number];

export interface PersonioProbeForm {
  index: number;
  postingId: string;
  url: string;
  outcome: PersonioProbeOutcome;
  questions: number;
  required: number;
  custom: number;
  documents: number;
  unhandled: string[];
}

export interface PersonioProbeSummary {
  total: number;
  readable: number;
  needsReview: number;
  unreadable: number;
  unsupported: number;
  passed: boolean;
}

export interface PersonioProbeReport {
  forms: PersonioProbeForm[];
  summary: PersonioProbeSummary;
}

export interface PersonioProbeDeps {
  catalogDb: CatalogDatabase;
  db: AppDatabase;
  clock: Clock;
  reader?: PlainFormReader;
  limit?: number;
  urls?: readonly string[] | undefined;
}

function summarise(forms: readonly PersonioProbeForm[]) {
  const count = (outcome: PersonioProbeOutcome) =>
    forms.filter((form) => form.outcome === outcome).length;

  const total = forms.length;
  const unreadable = count("unreadable");
  const unsupported = count("unsupported");

  return {
    total,
    readable: count("readable"),
    needsReview: count("needs_review"),
    unreadable,
    unsupported,
    passed: total === PERSONIO_PROBE_LIMIT && unreadable === 0 && unsupported === 0,
  } satisfies PersonioProbeSummary;
}

function outcomeFor(input: {
  questions: readonly { fieldName: string; label: string; fieldType: string; required: boolean }[];
  unhandled: readonly string[];
}) {
  if (input.questions.length === 0) {
    return "unreadable" satisfies PersonioProbeOutcome;
  }

  if (input.unhandled.length > 0) {
    return "unsupported" satisfies PersonioProbeOutcome;
  }

  const unresolvedRequired = input.questions.some(
    (question) =>
      question.required &&
      question.fieldType !== "file" &&
      mapQuestionByRules(question.label) === null,
  );

  return (unresolvedRequired ? "needs_review" : "readable") satisfies PersonioProbeOutcome;
}

const isCustom = (fieldName: string) => /^custom_attribute_\d+$/u.test(fieldName);

/**
 * Probes up to twenty open Personio postings by reading each application form
 * over plain HTTP. It spends no browser minutes, touches no user and never
 * submits: a form that reads completely is `readable`, a form whose required
 * custom question has no rule is an honest `needs_review`, and a form with a
 * control the flow cannot fill is `unsupported`.
 *
 * @param deps the database, clock and an optional form reader
 * @returns every form's result and the run's summary
 */
export async function runPersonioProbe(deps: PersonioProbeDeps) {
  const limit = deps.limit ?? PERSONIO_PROBE_LIMIT;
  const reader = deps.reader ?? createPlainFormReader({ environment: env.NODE_ENV });
  const runId = crypto.randomUUID();
  const limiter = limiterFor("personio", PERSONIO_LIMITS);

  const rows =
    deps.urls === undefined
      ? deps.catalogDb
          .select({
            id: postings.id,
            url: postings.url,
            applyUrl: postings.applyUrl,
            atsJobId: postings.atsJobId,
          })
          .from(postings)
          .where(and(eq(postings.ats, "personio"), isNull(postings.closedAt)))
          .orderBy(asc(postings.firstSeenAt), asc(postings.id))
          .limit(limit)
          .all()
      : deps.urls.map((url, index) => ({
          id: "",
          url,
          applyUrl: url,
          atsJobId:
            /^\/job\/(?<id>\d+)/u.exec(new URL(url).pathname)?.groups?.["id"] ?? String(index),
        }));

  const forms: PersonioProbeForm[] = [];

  type ProbeFrom = (index: number) => Promise<void>;

  const probeFrom: ProbeFrom = async (index) => {
    const row = rows[index];

    if (row === undefined) {
      return;
    }

    const url = row.applyUrl ?? row.url;

    let result: PersonioProbeForm = {
      index: index + 1,
      postingId: row.id,
      url,
      outcome: "unreadable",
      questions: 0,
      required: 0,
      custom: 0,
      documents: 0,
      unhandled: [],
    };

    try {
      const read = await limiter.run(async () =>
        reader.read({
          applyUrl: row.applyUrl,
          ats: "personio",
          atsJobId: row.atsJobId,
          boardToken: "",
          region: "us",
          url: row.url,
        }),
      );

      if (isLoginWallRead(read)) {
        result = {
          ...result,
          outcome: "unreadable",
          unhandled: read.evidence.markers.map((marker) => `login_wall:${marker}`),
        };
      } else if (read !== null) {
        const unhandled = "unhandled" in read ? read.unhandled : [];

        result = {
          ...result,
          outcome: outcomeFor({ questions: read.questions, unhandled }),
          questions: read.questions.length,
          required: read.questions.filter((question) => question.required).length,
          custom: read.questions.filter((question) => isCustom(question.fieldName)).length,
          documents: read.questions.filter((question) => question.fieldType === "file").length,
          unhandled,
        };
      }
    } catch (error) {
      result = {
        ...result,
        outcome: "unreadable",
        unhandled: [error instanceof Error ? error.message : String(error)],
      };
    }

    forms.push(result);

    recordLiveCheckResult(deps.db, deps.clock, runId, {
      check: "probe.personio",
      ok: result.outcome === "readable" || result.outcome === "needs_review",
      startedAt: deps.clock.now(),
      durationMs: 0,
      detail: {
        index: result.index,
        postingId: result.postingId,
        url: result.url,
        outcome: result.outcome,
        questions: result.questions,
        required: result.required,
        custom: result.custom,
        documents: result.documents,
        unhandled: result.unhandled.join(", "),
      },
    });

    await probeFrom(index + 1);
  };

  await probeFrom(0);

  const summary = summarise(forms);

  recordLiveCheckResult(deps.db, deps.clock, runId, {
    check: "probe.personio.summary",
    ok: summary.passed,
    startedAt: deps.clock.now(),
    durationMs: 0,
    detail: { ...summary },
  });

  return { forms, summary } satisfies PersonioProbeReport;
}
