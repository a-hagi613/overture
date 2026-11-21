import { useRef, useState } from "react";
import { Link } from "react-router";

import type { OnboardingTargetChoices, OnboardingTargetsView } from "../../shared/onboarding.ts";
import type { TargetsInput } from "../../shared/targets.ts";
import type { Seniority, Workplace } from "../../shared/tag-taxonomy.ts";
import type { SkipCompany } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { OnboardingTargetChip } from "./onboarding-target-chip.tsx";
import { OnboardingTargetChipGroup } from "./onboarding-target-chip-group.tsx";
import { SourceChip } from "./source-chip.tsx";

const moneyFormat = new Intl.NumberFormat("en-US");

const seniorityLabels: Record<Seniority, string> = {
  director: "Director",
  entry: "Entry",
  intern: "Intern",
  manager: "Manager",
  mid: copy.profile.targets.mid,
  principal: copy.profile.targets.lead,
  senior: copy.profile.targets.senior,
  staff: copy.profile.targets.staff,
};

const workplaceLabels: Record<Workplace, string> = {
  hybrid: copy.profile.targets.hybrid,
  onsite: copy.profile.targets.onSite,
  remote: copy.profile.targets.remote,
  unknown: "Unknown",
};

function toggle<T extends string>(values: readonly T[], value: T) {
  if (values.includes(value)) {
    return values.filter((candidate) => candidate !== value);
  }

  return [...values, value];
}

function choicesWithSelected<T extends string>(choices: readonly T[], selected: readonly T[]) {
  const merged = [...choices];

  for (const value of selected) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }

  return merged;
}

function salaryText(floorMinor: number | null) {
  return floorMinor === null ? "" : moneyFormat.format(floorMinor / 100);
}

function floorFromInput(raw: string) {
  const digits = raw.replaceAll(/[^0-9]/gu, "");

  return digits === "" ? null : Number(digits) * 100;
}

export function OnboardingTargetsCard({
  backTo = "/onboarding/facts",
  onContinue,
  save,
  saveSkip,
  skipCompanies,
  view,
}: {
  backTo?: string;
  onContinue: () => Promise<void> | void;
  save: (targets: TargetsInput) => Promise<OnboardingTargetsView>;
  saveSkip: (companies: { name: string; domain: string | null }[]) => Promise<{
    companies: SkipCompany[];
  }>;
  skipCompanies: SkipCompany[];
  view: OnboardingTargetsView;
}) {
  const [draft, setDraft] = useState<TargetsInput>(view.targets);
  const [matched, setMatched] = useState(view.matchedCount);
  const [salary, setSalary] = useState(() => salaryText(view.targets.salaryFloorMinor));
  const [newLocation, setNewLocation] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [companies, setCompanies] = useState(skipCompanies);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);

  const currency = draft.salaryCurrency ?? view.currencies[0] ?? "CAD";

  const commit = async (next: TargetsInput) => {
    setDraft(next);
    setFailed(false);

    const id = sequence.current + 1;

    sequence.current = id;

    try {
      const saved = await save(next);

      if (id === sequence.current) {
        setMatched(saved.matchedCount);
      }

      return true;
    } catch {
      setFailed(true);

      return false;
    }
  };

  const choices: OnboardingTargetChoices = view.choices;
  const roles = choicesWithSelected(choices.roles, draft.roles);
  const locations = choicesWithSelected(choices.locations, draft.locations);
  const seniorities = choicesWithSelected(choices.seniorities, draft.seniorities);
  const workplaces = choicesWithSelected(choices.workplaces, draft.workplaces);

  const userCompanies = companies.filter((company) => company.reason === "user");
  const currentEmployer = companies.find((company) => company.reason === "current_employer");

  async function persistCompanies(names: string[]) {
    try {
      const saved = await saveSkip(names.map((name) => ({ name, domain: null })));

      setCompanies(saved.companies);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  function addCompany() {
    const name = newCompany.trim();

    if (name === "") {
      return;
    }

    void persistCompanies([...userCompanies.map((company) => company.name), name]);
    setNewCompany("");
  }

  function commitSalary(raw: string) {
    const floor = floorFromInput(raw);

    void commit({
      ...draft,
      salaryCurrency: floor === null ? null : currency,
      salaryFloorMinor: floor,
    });
  }

  const continueOn = async () => {
    if (await commit(draft)) {
      await onContinue();
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
        {copy.onboarding.wantTitlePlain}{" "}
        <span className="italic">{copy.onboarding.wantTitleItalic}</span>
      </h2>
      <p className="mt-2.5 max-w-[52ch] text-[14.5px] text-muted-foreground">
        {copy.onboarding.wantIntro}
      </p>

      <div className="mt-6">
        <OnboardingTargetChipGroup
          headingId="w-roles"
          label={copy.onboarding.roles}
          note={copy.onboarding.atLeastOne}
        >
          {roles.map((role) => (
            <OnboardingTargetChip
              key={role}
              on={draft.roles.includes(role)}
              onClick={() => {
                void commit({ ...draft, roles: toggle(draft.roles, role) });
              }}
            >
              {role}
            </OnboardingTargetChip>
          ))}
        </OnboardingTargetChipGroup>
      </div>

      <div className="mt-[26px]">
        <OnboardingTargetChipGroup headingId="w-loc" label={copy.onboarding.cities}>
          {locations.map((location) => (
            <OnboardingTargetChip
              key={location}
              on={draft.locations.includes(location)}
              onClick={() => {
                void commit({ ...draft, locations: toggle(draft.locations, location) });
              }}
            >
              {location}
            </OnboardingTargetChip>
          ))}
        </OnboardingTargetChipGroup>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();

            const location = newLocation.trim();

            if (location !== "" && !draft.locations.includes(location)) {
              void commit({ ...draft, locations: [...draft.locations, location] });
            }

            setNewLocation("");
          }}
        >
          <input
            aria-label={copy.onboarding.addLocationPlaceholder}
            className="inp"
            onChange={(event) => {
              setNewLocation(event.currentTarget.value);
            }}
            placeholder={copy.onboarding.addLocationPlaceholder}
            style={{ flex: 1, minWidth: 0 }}
            value={newLocation}
          />
          <button className="btn2" style={{ minHeight: 40 }} type="submit">
            {copy.onboarding.add}
          </button>
        </form>
      </div>

      <div className="mt-[26px] grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-[18px]">
        <OnboardingTargetChipGroup headingId="w-work" label={copy.onboarding.workplace}>
          {workplaces.map((workplace) => (
            <OnboardingTargetChip
              key={workplace}
              on={draft.workplaces.includes(workplace)}
              onClick={() => {
                void commit({ ...draft, workplaces: toggle(draft.workplaces, workplace) });
              }}
            >
              {workplaceLabels[workplace]}
            </OnboardingTargetChip>
          ))}
        </OnboardingTargetChipGroup>
        <OnboardingTargetChipGroup headingId="w-sen" label={copy.onboarding.seniority}>
          {seniorities.map((seniority) => (
            <OnboardingTargetChip
              key={seniority}
              on={draft.seniorities.includes(seniority)}
              onClick={() => {
                void commit({ ...draft, seniorities: toggle(draft.seniorities, seniority) });
              }}
            >
              {seniorityLabels[seniority]}
            </OnboardingTargetChip>
          ))}
        </OnboardingTargetChipGroup>
      </div>

      <div className="mt-[26px]">
        <label className="lbl" htmlFor="w-sal">
          {copy.onboarding.salaryFloor}
        </label>
        <div className="flex max-w-[320px] items-center gap-2.5">
          <input
            className="inp num"
            id="w-sal"
            inputMode="numeric"
            onBlur={(event) => {
              commitSalary(event.currentTarget.value);
            }}
            onChange={(event) => {
              setSalary(event.currentTarget.value);
            }}
            style={{ flex: 1, minWidth: 0 }}
            value={salary}
          />
          <span className="flex-none text-[13px] text-muted-foreground">
            {copy.onboarding.salaryFloorUnit}
          </span>
        </div>
        <p className="hint mt-1.5">{copy.onboarding.salaryFloorNote}</p>
      </div>

      <div className="mt-[26px]">
        <label className="lbl" htmlFor="w-skip">
          {copy.onboarding.companiesToSkip}
        </label>
        {companies.length === 0 ? null : (
          <div className="mb-2 flex flex-wrap gap-2">
            {currentEmployer === undefined ? null : (
              <span className="inline-flex min-h-9 items-center gap-0.5 rounded-full border border-input bg-card px-[13px] text-[13px] font-semibold max-[767px]:min-h-11">
                {currentEmployer.name}
                <span className="ml-2">
                  <SourceChip variant="dashed">{copy.profile.skipList.currentEmployer}</SourceChip>
                </span>
              </span>
            )}
            {userCompanies.map((company) => (
              <span
                className="inline-flex min-h-9 items-center gap-0.5 rounded-full border border-input bg-card py-0 pr-1 pl-[13px] text-[13px] font-semibold leading-[normal] max-[767px]:min-h-11"
                key={company.id}
              >
                {company.name}
                <button
                  aria-label={copy.profile.facts.remove(company.name)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground max-[767px]:h-9 max-[767px]:w-9"
                  onClick={() => {
                    void persistCompanies(
                      userCompanies
                        .filter((candidate) => candidate.id !== company.id)
                        .map((candidate) => candidate.name),
                    );
                  }}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className="flex max-w-[520px] gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addCompany();
          }}
        >
          <input
            aria-label={copy.onboarding.addCompanyPlaceholder}
            className="inp"
            id="w-skip"
            onChange={(event) => {
              setNewCompany(event.currentTarget.value);
            }}
            placeholder={copy.onboarding.addCompanyPlaceholder}
            style={{ flex: 1, minWidth: 0 }}
            value={newCompany}
          />
          <button className="btn2" style={{ minHeight: 40 }} type="submit">
            {copy.onboarding.add}
          </button>
        </form>
        <p className="hint mt-1.5">{copy.onboarding.companiesToSkipNote}</p>
      </div>

      <output
        aria-live="polite"
        className="mt-7 block rounded-[10px] border border-input bg-background px-5 pt-5 pb-[18px]"
      >
        <span className="flex flex-wrap items-baseline gap-3">
          <span className="serif num text-[52px] leading-none" data-testid="targets-match-count">
            {matched}
          </span>
          <span className="text-[14.5px] font-semibold">{copy.onboarding.matchedLabel}</span>
        </span>
        <span className="hint mt-1 block">{copy.onboarding.matchedNote}</span>
      </output>

      {failed ? (
        <p className="hint mt-4 text-[color:var(--need)]" role="alert">
          {copy.onboarding.saveFailed}
        </p>
      ) : null}

      <div className="ftr mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Link className="btng" style={{ minHeight: 44 }} to={backTo}>
          <NavGlyph name="back" size={16} />
          {copy.onboarding.back}
        </Link>
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
    </section>
  );
}
