import { and, count, desc, eq, isNull, isNotNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";
import type { ReviewService } from "../pipeline/reviews.ts";
import type { Targets } from "../../shared/targets.ts";
import type { AnswerPeriod } from "../pipeline/answer-value.ts";
import type { FactRecord } from "./facts.ts";
import type {
  OnboardingFactsInput,
  QuestionUnlocks,
  SalaryAnswer,
  SalaryPeriodWord,
} from "../../shared/onboarding.ts";

import { applications, postings, reviewApplications, reviews } from "../platform/db/schema.ts";
import { countryCodesNamedIn, countryNameFor, resolveLocation } from "../catalog/geo.ts";
import { currencyNamedIn, parseSalaryExpectation } from "../pipeline/answer-value.ts";
import { createFactService } from "./facts.ts";
import { EEO_PREFER_NOT_TO_SAY, WORK_AUTH_OPTIONS } from "../../shared/onboarding.ts";
import {
  ONBOARDING_QUESTION_FACT_KEYS,
  isCurrencyCode,
  isCurrencyScopedFactKey,
} from "../../shared/facts.ts";

interface OpenReviewRow {
  id: string;
  factKey: string | null;
  scope: string;
  prompt: string;
}

const EEO_KEYS = ONBOARDING_QUESTION_FACT_KEYS.eeo;

const PERIOD_WORD_BY_KIND = {
  day: "a day",
  hour: "an hour",
  month: "a month",
  week: "a week",
  year: "a year",
} satisfies Record<AnswerPeriod, SalaryPeriodWord>;

function factValue(facts: readonly FactRecord[], key: string, scope = "") {
  return facts.find((fact) => fact.key === key && fact.scope === scope)?.value ?? "";
}

export function formatSalaryAmount(minor: number) {
  return new Intl.NumberFormat("en-US").format(minor / 100);
}

export function salaryAnswersFrom(facts: readonly FactRecord[]) {
  return facts
    .filter((fact) => fact.key === ONBOARDING_QUESTION_FACT_KEYS.salary && fact.scope !== "")
    .toSorted((left, right) => left.scope.localeCompare(right.scope))
    .map((fact) => {
      const parsed = parseSalaryExpectation(fact.value);

      return {
        amount: parsed === null ? fact.value : formatSalaryAmount(parsed.minMinor),
        currency: fact.scope,
        period:
          parsed?.period === null || parsed?.period === undefined
            ? ""
            : PERIOD_WORD_BY_KIND[parsed.period],
      } satisfies SalaryAnswer;
    });
}

export function salaryFactValue(answer: SalaryAnswer) {
  const digits = answer.amount.replaceAll(/[ ,]/gu, "");

  if (answer.period === "" || !/^[0-9]+(?:\.[0-9]{1,2})?$/u.test(digits)) {
    return null;
  }

  return `${answer.currency} ${formatSalaryAmount(Number(digits) * 100)} ${answer.period}`;
}

export function eeoAnswersFrom(facts: readonly FactRecord[]) {
  return {
    disability: factValue(facts, "eeo_disability") || EEO_PREFER_NOT_TO_SAY,
    enabled: EEO_KEYS.some((key) => facts.some((fact) => fact.key === key)),
    ethnicity: factValue(facts, "eeo_race_ethnicity") || EEO_PREFER_NOT_TO_SAY,
    gender: factValue(facts, "eeo_gender") || EEO_PREFER_NOT_TO_SAY,
    veteran: factValue(facts, "eeo_veteran") || EEO_PREFER_NOT_TO_SAY,
  };
}

function groupFor(
  review: OpenReviewRow,
  countryCodes: readonly string[],
  currencies: readonly string[],
) {
  if (review.factKey === ONBOARDING_QUESTION_FACT_KEYS.jobTitle) {
    return "jobTitle";
  }

  if (review.factKey === ONBOARDING_QUESTION_FACT_KEYS.hear) {
    return "hear";
  }

  if (review.factKey === ONBOARDING_QUESTION_FACT_KEYS.workAuth) {
    return review.scope !== "" && countryCodes.includes(review.scope) ? "workAuth" : null;
  }

  if (review.factKey === ONBOARDING_QUESTION_FACT_KEYS.salary) {
    const currency = currencyNamedIn(review.prompt);

    return currency !== null && currencies.includes(currency) ? "salary" : null;
  }

  if (review.factKey !== null && EEO_KEYS.some((key) => key === review.factKey)) {
    return "eeo";
  }

  return null;
}

function reviewAnswers(review: OpenReviewRow, fact: { key: string; scope: string; value: string }) {
  if (isCurrencyScopedFactKey(fact.key)) {
    return currencyNamedIn(review.prompt) === fact.scope;
  }

  return fact.scope === "" || review.scope === fact.scope;
}

function reviewsAnsweredBy(
  saved: readonly { key: string; scope: string; value: string }[],
  open: readonly OpenReviewRow[],
) {
  return saved.flatMap((fact) =>
    open.flatMap((review) =>
      review.factKey === fact.key && reviewAnswers(review, fact) ? [{ fact, review }] : [],
    ),
  );
}

const CURRENCY_BY_COUNTRY = {
  AT: "EUR",
  AU: "AUD",
  BE: "EUR",
  CA: "CAD",
  CH: "CHF",
  DE: "EUR",
  DK: "DKK",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GB: "GBP",
  IE: "EUR",
  IN: "INR",
  IT: "EUR",
  NL: "EUR",
  NO: "NOK",
  NZ: "NZD",
  PT: "EUR",
  SE: "SEK",
  SG: "SGD",
  US: "USD",
} as const satisfies Record<string, string>;

function currencyForCountry(code: string) {
  return Object.entries(CURRENCY_BY_COUNTRY).find(([country]) => country === code)?.[1];
}

function targetCountryCodes(targets: Targets) {
  const codes: string[] = [];

  for (const location of targets.locations) {
    const code = resolveLocation(location).countryCode;

    if (code !== null && !codes.includes(code)) {
      codes.push(code);
    }
  }

  return codes;
}

export function createOnboardingStepService(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  reviewService: ReviewService;
  readTargets: (userId: string) => Promise<{ targets: Targets }>;
}) {
  const { db, clock, personal, reviewService, readTargets } = deps;

  const factsService = createFactService({ db, clock, personal });

  function openReviews(userId: string) {
    return db
      .select({
        factKey: reviews.factKey,
        id: reviews.id,
        prompt: reviews.prompt,
        scope: reviews.scope,
      })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
      .all();
  }

  function queuedApplicationIdsByReview(userId: string) {
    const rows = db
      .select({
        applicationId: reviewApplications.applicationId,
        reviewId: reviewApplications.reviewId,
      })
      .from(reviewApplications)
      .innerJoin(applications, eq(applications.id, reviewApplications.applicationId))
      .innerJoin(reviews, eq(reviews.id, reviewApplications.reviewId))
      .where(
        and(
          eq(reviews.userId, userId),
          eq(reviews.status, "open"),
          eq(applications.stage, "queued"),
        ),
      )
      .all();

    const byReview = new Map<string, Set<string>>();

    for (const row of rows) {
      const ids = byReview.get(row.reviewId) ?? new Set<string>();

      ids.add(row.applicationId);
      byReview.set(row.reviewId, ids);
    }

    return byReview;
  }

  function queuedCurrencies(userId: string) {
    const rows = db
      .select({ currency: postings.salaryCurrency })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .where(and(eq(applications.userId, userId), eq(applications.stage, "queued")))
      .all();

    const counts = new Map<string, number>();

    for (const row of rows) {
      const currency = row.currency?.toUpperCase() ?? "";

      if (isCurrencyCode(currency)) {
        counts.set(currency, (counts.get(currency) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([currency]) => currency);
  }

  function openPostingCountries() {
    return db
      .select({ code: postings.countryCode, total: count() })
      .from(postings)
      .where(and(isNull(postings.closedAt), isNotNull(postings.countryCode)))
      .groupBy(postings.countryCode)
      .orderBy(desc(count()), postings.countryCode)
      .limit(3)
      .all()
      .flatMap((row) => (row.code === null ? [] : [row.code]));
  }

  async function read(userId: string, options: { inferCountries?: boolean } = {}) {
    const facts = await factsService.list(userId);
    const { targets } = await readTargets(userId);
    const open = openReviews(userId);

    const countryCodes = targetCountryCodes(targets);

    for (const review of open) {
      if (
        review.factKey === ONBOARDING_QUESTION_FACT_KEYS.workAuth &&
        review.scope !== "" &&
        !countryCodes.includes(review.scope)
      ) {
        countryCodes.push(review.scope);
      }
    }

    for (const fact of facts) {
      if (
        fact.key === ONBOARDING_QUESTION_FACT_KEYS.workAuth &&
        fact.scope !== "" &&
        !countryCodes.includes(fact.scope)
      ) {
        countryCodes.push(fact.scope);
      }
    }

    if (countryCodes.length === 0 && options.inferCountries !== false) {
      const home = countryCodesNamedIn(factValue(facts, "current_country")).at(0);

      countryCodes.push(...(home === undefined ? openPostingCountries() : [home]));
    }

    const currencies = queuedCurrencies(userId);
    const salaryAnswers = salaryAnswersFrom(facts);

    for (const saved of salaryAnswers) {
      if (!currencies.includes(saved.currency)) {
        currencies.push(saved.currency);
      }
    }

    if (currencies.length === 0 && options.inferCountries !== false) {
      for (const code of countryCodes) {
        const currency = currencyForCountry(code);

        if (currency !== undefined && !currencies.includes(currency)) {
          currencies.push(currency);
        }
      }
    }

    if (
      targets.salaryCurrency !== null &&
      isCurrencyCode(targets.salaryCurrency) &&
      !currencies.includes(targets.salaryCurrency)
    ) {
      currencies.push(targets.salaryCurrency);
    }

    const stepAnswers = {
      eeo: eeoAnswersFrom(facts),
      hear: factValue(facts, ONBOARDING_QUESTION_FACT_KEYS.hear),
      jobTitle: factValue(facts, ONBOARDING_QUESTION_FACT_KEYS.jobTitle),
      salary: salaryAnswers.filter((answer) => currencies.includes(answer.currency)),
      workAuth: Object.fromEntries(
        countryCodes.flatMap((code) => {
          const value = factValue(facts, ONBOARDING_QUESTION_FACT_KEYS.workAuth, code);

          return value === "" ? [] : [[code, value] as const];
        }),
      ),
    };

    const attachments = queuedApplicationIdsByReview(userId);

    const counted: Record<keyof QuestionUnlocks, Set<string>> = {
      eeo: new Set(),
      hear: new Set(),
      jobTitle: new Set(),
      salary: new Set(),
      workAuth: new Set(),
    };

    for (const review of open) {
      const group = groupFor(review, countryCodes, currencies);

      if (group === null) {
        continue;
      }

      for (const applicationId of attachments.get(review.id) ?? []) {
        counted[group].add(applicationId);
      }
    }

    return {
      answers: stepAnswers,
      countries: countryCodes.map((code) => ({
        code,
        name: countryNameFor(code) ?? code,
      })),
      currencies,
      unlocks: {
        eeo: counted.eeo.size,
        hear: counted.hear.size,
        jobTitle: counted.jobTitle.size,
        salary: counted.salary.size,
        workAuth: counted.workAuth.size,
      },
    };
  }

  async function resolveReviews(
    userId: string,
    saved: readonly { key: string; scope: string; value: string }[],
    open: readonly OpenReviewRow[],
  ) {
    await Promise.all(
      reviewsAnsweredBy(saved, open).map(async ({ fact, review }) => {
        await reviewService.answer(userId, review.id, fact.value, {
          fact: { key: fact.key, scope: fact.scope },
          prepare: "enqueue",
        });
      }),
    );
  }

  async function save(userId: string, input: OnboardingFactsInput) {
    const previous = new Map(
      (await factsService.list(userId)).map((fact) => [`${fact.key}\u0000${fact.scope}`, fact]),
    );

    const saved: { key: string; scope: string; value: string }[] = [];
    const removed: { key: string; scope: string | null }[] = [];

    const jobTitle = input.jobTitle?.trim() ?? "";

    if (jobTitle !== "") {
      saved.push({ key: ONBOARDING_QUESTION_FACT_KEYS.jobTitle, scope: "", value: jobTitle });
    } else if (input.jobTitle !== undefined) {
      removed.push({ key: ONBOARDING_QUESTION_FACT_KEYS.jobTitle, scope: null });
    }

    const hear = input.hear?.trim() ?? "";

    if (hear !== "") {
      saved.push({ key: ONBOARDING_QUESTION_FACT_KEYS.hear, scope: "", value: hear });
    } else if (input.hear !== undefined) {
      removed.push({ key: ONBOARDING_QUESTION_FACT_KEYS.hear, scope: null });
    }

    for (const answer of input.workAuth ?? []) {
      const value = answer.value.trim();

      if (value !== "" && WORK_AUTH_OPTIONS.some((option) => option === value)) {
        saved.push({
          key: ONBOARDING_QUESTION_FACT_KEYS.workAuth,
          scope: answer.code,
          value,
        });
      } else if (value === "") {
        removed.push({ key: ONBOARDING_QUESTION_FACT_KEYS.workAuth, scope: answer.code });
      }
    }

    for (const answer of input.salary ?? []) {
      const value = salaryFactValue(answer);

      if (value !== null) {
        saved.push({
          key: ONBOARDING_QUESTION_FACT_KEYS.salary,
          scope: answer.currency,
          value,
        });
      } else if (answer.amount.trim() === "" && answer.period === "") {
        removed.push({ key: ONBOARDING_QUESTION_FACT_KEYS.salary, scope: answer.currency });
      }
    }

    if (input.eeo !== undefined) {
      if (input.eeo.enabled) {
        saved.push(
          { key: "eeo_gender", scope: "", value: input.eeo.gender },
          { key: "eeo_race_ethnicity", scope: "", value: input.eeo.ethnicity },
          { key: "eeo_veteran", scope: "", value: input.eeo.veteran },
          { key: "eeo_disability", scope: "", value: input.eeo.disability },
        );
      } else {
        removed.push(...EEO_KEYS.map((key) => ({ key, scope: null })));
      }
    }

    const changed = saved.filter(
      (fact) => previous.get(`${fact.key}\u0000${fact.scope}`)?.value !== fact.value,
    );

    await Promise.all(
      removed.map(async (fact) => {
        await factsService.remove(userId, fact.key, fact.scope);
      }),
    );

    await Promise.all(
      saved.map(async (fact) => {
        await factsService.save(userId, fact.key, fact.value, fact.scope);
      }),
    );

    await resolveReviews(userId, changed, openReviews(userId));

    return read(userId);
  }

  return { read, save };
}

export type OnboardingStepService = ReturnType<typeof createOnboardingStepService>;
