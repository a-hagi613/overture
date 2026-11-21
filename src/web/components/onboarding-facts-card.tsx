import { Fragment, useState } from "react";
import { Link } from "react-router";

import type {
  EeoAnswers,
  OnboardingFactsInput,
  OnboardingFactsView,
} from "../../shared/onboarding.ts";
import type { SalaryDraft } from "./onboarding-salary-row.tsx";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { OnboardingEeoField } from "./onboarding-eeo-field.tsx";
import { OnboardingSalaryRow } from "./onboarding-salary-row.tsx";
import { OnboardingSelectField } from "./onboarding-select-field.tsx";
import { OnboardingStatus } from "./onboarding-status.tsx";
import { OnboardingUnlocks } from "./onboarding-unlocks.tsx";

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
  onContinue,
  save,
  view,
}: {
  onContinue: () => void;
  save: (input: OnboardingFactsInput) => Promise<OnboardingFactsView>;
  view: OnboardingFactsView;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(view));
  const [failed, setFailed] = useState(false);

  const commit = async (next: Draft) => {
    setDraft(next);
    setFailed(false);

    try {
      await save(toPayload(next));

      return true;
    } catch {
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
    if (await commit(draft)) {
      onContinue();
    }
  };

  return (
    <section
      aria-labelledby="ob-h"
      className="obd rounded-lg border border-border bg-card shadow-sh"
    >
      <h2
        className="serif"
        id="ob-h"
        style={{ fontSize: "clamp(28px, 4vw, 36px)", lineHeight: 1.1 }}
      >
        {copy.onboarding.cardTitlePlain}{" "}
        <span className="italic">{copy.onboarding.cardTitleItalic}</span>
      </h2>
      <p className="mt-2 max-w-[52ch] text-[14.5px] text-muted-foreground">
        {copy.onboarding.cardIntro}
      </p>
      <p className="qnote mt-[18px]">{copy.onboarding.note}</p>

      <div className="qf">
        <div className="qh">
          <label className="lbl flat" htmlFor="q-title">
            {copy.onboarding.jobTitle}
          </label>
          <OnboardingUnlocks count={view.unlocks.jobTitle} />
        </div>
        <input
          autoComplete={copy.onboarding.jobTitleAutocomplete}
          className="inp max-w-[380px]"
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

      <div className="qf">
        <div className="qh">
          <h3 className="lbl flat" id="q-wa">
            {copy.onboarding.workAuth}
          </h3>
          <OnboardingUnlocks count={view.unlocks.workAuth} />
        </div>
        <p className="hint mb-3">{copy.onboarding.workAuthHint}</p>
        <fieldset aria-labelledby="q-wa" className="wa m-0 min-w-0 border-0 p-0">
          {view.countries.map((country) => (
            <Fragment key={country.code}>
              <label className="lbl flat" htmlFor={`wa-${country.code.toLowerCase()}`}>
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
            </Fragment>
          ))}
        </fieldset>
        <p className="mt-2">
          <OnboardingStatus
            answered={workAuthAnswered !== 0}
            label={copy.onboarding.answeredOf(workAuthAnswered, view.countries.length)}
          />
        </p>
      </div>

      <div className="qf">
        <div className="qh">
          <h3 className="lbl flat" id="q-sal">
            {copy.onboarding.salary}
          </h3>
          <OnboardingUnlocks count={view.unlocks.salary} />
        </div>
        <p className="hint mb-3">{copy.onboarding.salaryHint}</p>
        <fieldset aria-labelledby="q-sal" className="sal m-0 min-w-0 border-0 p-0">
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
        <p className="mt-2">
          <OnboardingStatus
            answered={salaryAnswered !== 0}
            label={copy.onboarding.answeredOf(salaryAnswered, view.currencies.length)}
          />
        </p>
      </div>

      <div className="qf">
        <div className="qh">
          <label className="lbl flat" htmlFor="q-hear">
            {copy.onboarding.hear}{" "}
            <span className="req ml-1.5">{copy.onboarding.hearOptional}</span>
          </label>
          <OnboardingUnlocks count={view.unlocks.hear} />
        </div>
        <input
          className="inp max-w-[380px]"
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

      <div className="qf">
        <div className="qh">
          <h3 className="lbl flat" id="q-eeo">
            {copy.onboarding.eeo}
          </h3>
          <OnboardingUnlocks count={view.unlocks.eeo} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="hint max-w-[44ch]">{copy.onboarding.eeoHint}</p>
          <button
            aria-checked={draft.eeo.enabled}
            aria-labelledby="q-eeo-sw"
            className={`sw2${draft.eeo.enabled ? " on" : ""}`}
            onClick={() => {
              update({ eeo: { ...draft.eeo, enabled: !draft.eeo.enabled } });
            }}
            role="switch"
            style={{ flex: "0 0 auto" }}
            type="button"
          >
            <span className="trk">
              <span className="thb" />
            </span>
          </button>
        </div>
        <span className="sr-only" id="q-eeo-sw">
          {copy.onboarding.eeoSwitch}
        </span>
        <div className="eeo mt-3.5">
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

      {failed ? (
        <p className="hint mt-4 text-[color:var(--need)]" role="alert">
          {copy.onboarding.saveFailed}
        </p>
      ) : null}

      <div className="ftr mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Link className="btng" style={{ minHeight: 44 }} to="/profile#profile-facts">
          <NavGlyph name="back" size={16} />
          {copy.onboarding.back}
        </Link>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2.5">
          <p className="hint why2 text-right">{copy.onboarding.skipNote}</p>
          <button
            className="btn"
            onClick={() => {
              void continueOn();
            }}
            style={{ minHeight: 48, padding: "0 26px" }}
            type="button"
          >
            {copy.onboarding.continue} <NavGlyph name="forward" size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
