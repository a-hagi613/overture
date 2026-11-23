import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import type {
  EeoAnswers,
  OnboardingFactsInput,
  OnboardingFactsView,
} from "../../shared/onboarding.ts";
import type { SalaryDraft } from "./onboarding-salary-row.tsx";

import { copy } from "../../shared/copy.ts";
import { OnboardingEeoField } from "./onboarding-eeo-field.tsx";
import { OnboardingSalaryRow } from "./onboarding-salary-row.tsx";
import { OnboardingSelectField } from "./onboarding-select-field.tsx";
import { OnboardingStatus } from "./onboarding-status.tsx";
import { OnboardingUnlocks } from "./onboarding-unlocks.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";
import { Switch } from "./ui/switch.tsx";

interface Draft {
  eeo: EeoAnswers;
  hear: string;
  jobTitle: string;
  salary: Record<string, SalaryDraft>;
  workAuth: Record<string, string>;
}

function toDraft(view: OnboardingFactsView) {
  const salary: Record<string, SalaryDraft> = {};

  for (const currency of view.currencies) {
    const saved = view.answers.salary.find((answer) => answer.currency === currency);

    salary[currency] = { amount: saved?.amount ?? "", period: saved?.period ?? "" };
  }

  const workAuth: Record<string, string> = {};

  for (const country of view.countries) {
    workAuth[country.code] = view.answers.workAuth[country.code] ?? "";
  }

  return {
    eeo: view.answers.eeo,
    hear: view.answers.hear,
    jobTitle: view.answers.jobTitle,
    salary,
    workAuth,
  } satisfies Draft;
}

function toPayload(draft: Draft) {
  return {
    eeo: draft.eeo,
    hear: draft.hear,
    jobTitle: draft.jobTitle,
    salary: Object.entries(draft.salary).map(([currency, entry]) => ({
      amount: entry.amount,
      currency,
      period: entry.period,
    })),
    workAuth: Object.entries(draft.workAuth).map(([code, value]) => ({ code, value })),
  } satisfies OnboardingFactsInput;
}

export function OnboardingFactsCard({
  backTo = "/onboarding/resume",
  onContinue,
  preview = false,
  save,
  view,
}: {
  backTo?: string;
  onContinue: () => Promise<void> | void;
  preview?: boolean;
  save: (input: OnboardingFactsInput) => Promise<OnboardingFactsView>;
  view: OnboardingFactsView;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(view));
  const [failed, setFailed] = useState(false);
  const [continuing, setContinuing] = useState(false);

  const commit = async (next: Draft) => {
    setDraft(next);
    setFailed(false);

    try {
      await save(toPayload(next));

      return true;
    } catch {
      if (preview) {
        return true;
      }

      setFailed(true);

      return false;
    }
  };

  const update = (patch: Partial<Draft>) => {
    void commit({ ...draft, ...patch });
  };

  const jobAnswered = draft.jobTitle.trim() !== "";
  const hearAnswered = draft.hear.trim() !== "";
  const workAuthAnswered = Object.values(draft.workAuth).filter((value) => value !== "").length;

  const salaryAnswered = Object.values(draft.salary).filter(
    (entry) => entry.amount.trim() !== "",
  ).length;

  const continueOn = async () => {
    if (continuing) {
      return;
    }

    setContinuing(true);
    setFailed(false);

    try {
      if (await commit(draft)) {
        await onContinue();
      } else {
        setContinuing(false);
      }
    } catch {
      setFailed(true);
      setContinuing(false);
    }
  };

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-8" variant="elevated">
      <h2 className={dsCardTitle} id="ob-h">
        {`${copy.onboarding.cardTitlePlain} ${copy.onboarding.cardTitleItalic}`}
      </h2>
      <p className={`${dsBody} mt-2 max-w-xl`}>{copy.onboarding.cardIntro}</p>
      <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground">
        {copy.onboarding.note}
      </p>

      <div className="mt-6 divide-y divide-border">
        <div className="py-5 first:pt-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-semibold text-foreground" htmlFor="q-title">
              {copy.onboarding.jobTitle}
            </label>
            <OnboardingUnlocks count={view.unlocks.jobTitle} />
          </div>
          <Input
            autoComplete={copy.onboarding.jobTitleAutocomplete}
            className="max-w-md"
            id="q-title"
            onBlur={() => {
              void commit(draft);
            }}
            onChange={(event) => {
              setDraft({ ...draft, jobTitle: event.target.value });
            }}
            value={draft.jobTitle}
          />
          <p className="mt-2">
            <OnboardingStatus answered={jobAnswered} />
          </p>
        </div>

        <div className="py-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground" id="q-wa">
              {copy.onboarding.workAuth}
            </h3>
            <OnboardingUnlocks count={view.unlocks.workAuth} />
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{copy.onboarding.workAuthHint}</p>
          <fieldset aria-labelledby="q-wa" className="m-0 space-y-2.5 border-0 p-0">
            {view.countries.map((country) => (
              <div
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[140px_minmax(0,1fr)]"
                key={country.code}
              >
                <label
                  className="text-xs font-semibold text-foreground"
                  htmlFor={`wa-${country.code.toLowerCase()}`}
                >
                  {country.name}
                </label>
                <OnboardingSelectField
                  ariaLabel={copy.onboarding.workAuthFor(country.name)}
                  id={`wa-${country.code.toLowerCase()}`}
                  onChange={(value) => {
                    update({ workAuth: { ...draft.workAuth, [country.code]: value } });
                  }}
                  options={copy.onboarding.workAuthOptions}
                  placeholder={copy.onboarding.choose}
                  value={draft.workAuth[country.code] ?? ""}
                />
              </div>
            ))}
          </fieldset>
          <p className="mt-2.5">
            <OnboardingStatus
              answered={workAuthAnswered !== 0}
              label={copy.onboarding.answeredOf(workAuthAnswered, view.countries.length)}
            />
          </p>
        </div>

        <div className="py-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground" id="q-sal">
              {copy.onboarding.salary}
            </h3>
            <OnboardingUnlocks count={view.unlocks.salary} />
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{copy.onboarding.salaryHint}</p>
          <fieldset aria-labelledby="q-sal" className="m-0 space-y-2.5 border-0 p-0">
            {view.currencies.map((currency) => {
              const entry = draft.salary[currency] ?? { amount: "", period: "" };

              return (
                <OnboardingSalaryRow
                  commitAmount={(amount) => {
                    void commit({
                      ...draft,
                      salary: { ...draft.salary, [currency]: { ...entry, amount } },
                    });
                  }}
                  commitPeriod={(period) => {
                    void commit({
                      ...draft,
                      salary: { ...draft.salary, [currency]: { ...entry, period } },
                    });
                  }}
                  currency={currency}
                  entry={entry}
                  key={currency}
                  onChange={(patch) => {
                    setDraft({
                      ...draft,
                      salary: { ...draft.salary, [currency]: { ...entry, ...patch } },
                    });
                  }}
                />
              );
            })}
          </fieldset>
          <p className="mt-2.5">
            <OnboardingStatus
              answered={salaryAnswered !== 0}
              label={copy.onboarding.answeredOf(salaryAnswered, view.currencies.length)}
            />
          </p>
        </div>

        <div className="py-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-semibold text-foreground" htmlFor="q-hear">
              {`${copy.onboarding.hear} `}
              <span className="font-normal text-muted-foreground">
                {copy.onboarding.hearOptional}
              </span>
            </label>
            <OnboardingUnlocks count={view.unlocks.hear} />
          </div>
          <Input
            className="max-w-md"
            id="q-hear"
            onBlur={() => {
              void commit(draft);
            }}
            onChange={(event) => {
              setDraft({ ...draft, hear: event.target.value });
            }}
            placeholder={copy.onboarding.hearPlaceholder}
            value={draft.hear}
          />
          <p className="mt-2">
            <OnboardingStatus answered={hearAnswered} />
          </p>
        </div>

        <div className="py-5 last:pb-0">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground" id="q-eeo">
              {copy.onboarding.eeo}
            </h3>
            <OnboardingUnlocks count={view.unlocks.eeo} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-md text-xs text-muted-foreground">{copy.onboarding.eeoHint}</p>
            <Switch
              ariaLabel={copy.onboarding.eeoSwitch}
              checked={draft.eeo.enabled}
              onCheckedChange={(enabled) => {
                update({ eeo: { ...draft.eeo, enabled } });
              }}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OnboardingEeoField
              disabled={!draft.eeo.enabled}
              id="eeo-g"
              label={copy.onboarding.eeoFields.gender}
              onChange={(gender) => {
                update({ eeo: { ...draft.eeo, gender } });
              }}
              options={copy.onboarding.eeoOptions.gender}
              value={draft.eeo.gender}
            />
            <OnboardingEeoField
              disabled={!draft.eeo.enabled}
              id="eeo-e"
              label={copy.onboarding.eeoFields.ethnicity}
              onChange={(ethnicity) => {
                update({ eeo: { ...draft.eeo, ethnicity } });
              }}
              options={copy.onboarding.eeoOptions.ethnicity}
              value={draft.eeo.ethnicity}
            />
            <OnboardingEeoField
              disabled={!draft.eeo.enabled}
              id="eeo-v"
              label={copy.onboarding.eeoFields.veteran}
              onChange={(veteran) => {
                update({ eeo: { ...draft.eeo, veteran } });
              }}
              options={copy.onboarding.eeoOptions.veteran}
              value={draft.eeo.veteran}
            />
            <OnboardingEeoField
              disabled={!draft.eeo.enabled}
              id="eeo-d"
              label={copy.onboarding.eeoFields.disability}
              onChange={(disability) => {
                update({ eeo: { ...draft.eeo, disability } });
              }}
              options={copy.onboarding.eeoOptions.disability}
              value={draft.eeo.disability}
            />
          </div>
        </div>
      </div>

      {failed ? (
        <p className="mt-4 text-xs font-semibold text-need" role="alert">
          {copy.onboarding.saveFailed}
        </p>
      ) : null}

      <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button asChild size="default" variant="ghost">
          <Link to={backTo}>
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{copy.onboarding.back}</span>
          </Link>
        </Button>
        <Button
          ariaBusy={continuing}
          disabled={continuing}
          onClick={() => {
            void continueOn();
          }}
          size="lg"
          variant="primary"
        >
          <span>{copy.onboarding.continue}</span>
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </Card>
  );
}
