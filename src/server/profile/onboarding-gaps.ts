import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";
import type { FactRecord } from "./facts.ts";
import type { OnboardingGapsInput, OnboardingGapsView } from "../../shared/onboarding.ts";
import type { KeyDetailFactKey } from "../../shared/key-details.ts";

import { parseSalaryExpectation } from "../pipeline/answer-value.ts";
import { isCountryScopedFactKey } from "../../shared/facts.ts";
import { KEY_DETAIL_FACT_KEYS, KEY_DETAIL_FACT_LABELS } from "../../shared/key-details.ts";
import { createFactService } from "./facts.ts";
import { countryCodeFrom, homeCountryCode } from "./onboarding-step.ts";

function preferredScope(key: KeyDetailFactKey, countryCode: string | null) {
  return isCountryScopedFactKey(key) ? (countryCode ?? "") : "";
}

function chosenRecord(key: KeyDetailFactKey, facts: readonly FactRecord[], preferred: string) {
  const candidates = facts.filter((fact) => fact.key === key);

  return (
    candidates.find((fact) => fact.scope === preferred) ??
    candidates.find((fact) => fact.scope === "") ??
    candidates.toSorted((left, right) => left.scope.localeCompare(right.scope)).at(0)
  );
}

/**
 * The fill-the-gaps screen's data: every key detail in one fixed order, with the
 * value the resume reader already found, so the screen only asks what is missing.
 * Saving confirms the values, which is what later application forms answer from.
 * @param deps The database, clock, personal crypto and current-employer writer the screen runs under.
 * @returns The gaps service, whose read and save share the one field order.
 */
export function createOnboardingGapsService(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  skipCompanies: { setCurrentEmployer: (userId: string, name: string) => Promise<void> };
}) {
  const { db, clock, personal, skipCompanies } = deps;

  const factsService = createFactService({ db, clock, personal });

  async function read(userId: string) {
    const facts = await factsService.list(userId);
    const countryCode = homeCountryCode(facts);

    return {
      fields: KEY_DETAIL_FACT_KEYS.map((key) => {
        const preferred = preferredScope(key, countryCode);
        const record = chosenRecord(key, facts, preferred);

        return {
          confirmed: record?.confirmed ?? false,
          key,
          label: KEY_DETAIL_FACT_LABELS[key],
          source: record?.source ?? null,
          value: record?.value ?? "",
        };
      }),
    } satisfies OnboardingGapsView;
  }

  async function save(userId: string, input: OnboardingGapsInput) {
    const facts = await factsService.list(userId);
    const submittedCountry = input.fields.find((field) => field.key === "current_country");

    const countryCode =
      submittedCountry === undefined || submittedCountry.value.trim() === ""
        ? homeCountryCode(facts)
        : countryCodeFrom(submittedCountry.value);

    await Promise.all(
      input.fields.map(async (field) => {
        const value = field.value.trim();

        const scope =
          field.key === "salary_expectation"
            ? (parseSalaryExpectation(value)?.currency ?? "")
            : preferredScope(field.key, countryCode);

        if (value === "") {
          await factsService.remove(userId, field.key, scope);

          return;
        }

        await factsService.confirm(userId, field.key, value, scope);
      }),
    );

    const employer = input.fields.find((field) => field.key === "current_employer");

    if (employer !== undefined && employer.value.trim() !== "") {
      await skipCompanies.setCurrentEmployer(userId, employer.value.trim());
    }

    return read(userId);
  }

  return { read, save };
}

export type OnboardingGapsService = ReturnType<typeof createOnboardingGapsService>;
