import { ArrowLeft, ArrowRight, ChevronDown, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type { OnboardingTargetChoices, OnboardingTargetsView } from "../../shared/onboarding.ts";
import type { TargetsInput } from "../../shared/targets.ts";
import type { RoleGroup, Seniority, Workplace } from "../../shared/tag-taxonomy.ts";
import type { SkipCompany } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import { escoGranularRolesFor } from "../../shared/esco-roles.ts";
import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";
import { OnboardingBlockedEmployers } from "./onboarding-blocked-employers.tsx";
import { OnboardingTargetChip } from "./onboarding-target-chip.tsx";
import { OnboardingTargetChipGroup } from "./onboarding-target-chip-group.tsx";
import { RolePicker } from "./ui/role-picker.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow, dsMetric } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

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
  backTo = "/onboarding/resume",
  currentEmployer,
  onContinue,
  preview = false,
  save,
  saveCurrentEmployer,
  saveSkip,
  skipCompanies,
  view,
}: {
  backTo?: string;
  currentEmployer: string | null;
  onContinue: () => Promise<void> | void;
  preview?: boolean;
  save: (targets: TargetsInput) => Promise<OnboardingTargetsView>;
  saveCurrentEmployer: (name: string) => Promise<void> | void;
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
  const [category, setCategory] = useState<RoleGroup | null>(null);
  const [failed, setFailed] = useState(false);
  const [continuing, setContinuing] = useState(false);
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
      if (preview) {
        return true;
      }

      setFailed(true);

      return false;
    }
  };

  const choices: OnboardingTargetChoices = view.choices;
  const roles = choicesWithSelected(choices.roles, draft.roles);
  const locations = choicesWithSelected(choices.locations, draft.locations);
  const seniorities = choicesWithSelected(choices.seniorities, draft.seniorities);
  const workplaces = choicesWithSelected(choices.workplaces, draft.workplaces);

  function commitSalary(raw: string) {
    const floor = floorFromInput(raw);

    void commit({
      ...draft,
      salaryCurrency: floor === null ? null : currency,
      salaryFloorMinor: floor,
    });
  }

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
        {`${copy.onboarding.wantTitlePlain} ${copy.onboarding.wantTitleItalic}`}
      </h2>
      <p className={`${dsBody} mt-2 max-w-xl`}>{copy.onboarding.wantIntro}</p>

      <div className="mt-6 space-y-6">
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={`${dsEyebrow} block`} htmlFor="w-category">
              {copy.onboarding.categoryLabel}
            </label>
            <div className="relative mt-2">
              <select
                className="h-12 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3.5 pr-10 text-sm font-medium text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                id="w-category"
                onChange={(event) => {
                  const next = event.currentTarget.value;

                  setCategory(ROLE_GROUPS.find((group) => group === next) ?? null);
                }}
                value={category ?? ""}
              >
                <option value="">{copy.onboarding.categoryAny}</option>
                {ROLE_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={16}
              />
            </div>
          </div>
          <RolePicker
            allowFreeText
            clearLabel={copy.onboarding.pickRoleClear}
            id="w-role"
            label={copy.onboarding.pickRoleLabel}
            onChange={(role) => {
              if (role !== null && !draft.roles.includes(role)) {
                void commit({ ...draft, roles: [...draft.roles, role] });
              }
            }}
            options={escoGranularRolesFor(category)
              .filter((option) => !draft.roles.includes(option.role))
              .map((option) => ({ hint: option.category, value: option.role }))}
            placeholder={copy.onboarding.pickRolePlaceholder}
            value={null}
          />
        </div>

        <div>
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
            className="mt-3 flex max-w-md gap-2"
            onSubmit={(event) => {
              event.preventDefault();

              const location = newLocation.trim();

              if (location !== "" && !draft.locations.includes(location)) {
                void commit({ ...draft, locations: [...draft.locations, location] });
              }

              setNewLocation("");
            }}
          >
            <Input
              ariaLabel={copy.onboarding.addLocationPlaceholder}
              onChange={(event) => {
                setNewLocation(event.currentTarget.value);
              }}
              placeholder={copy.onboarding.addLocationPlaceholder}
              value={newLocation}
            />
            <Button size="default" submit variant="secondary">
              <Plus aria-hidden="true" size={14} />
              <span>{copy.onboarding.add}</span>
            </Button>
          </form>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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

        <div>
          <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-sal">
            {copy.onboarding.salaryFloor}
          </label>
          <div className="flex max-w-xs items-center gap-2.5">
            <Input
              className="tabular-nums"
              id="w-sal"
              inputMode="numeric"
              onBlur={(event) => {
                commitSalary(event.currentTarget.value);
              }}
              onChange={(event) => {
                setSalary(event.currentTarget.value);
              }}
              value={salary}
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {copy.onboarding.salaryFloorUnit}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{copy.onboarding.salaryFloorNote}</p>
        </div>

        <OnboardingBlockedEmployers
          currentEmployer={currentEmployer}
          onSaveCurrentEmployer={async (name) => {
            try {
              await saveCurrentEmployer(name);
            } catch {
              if (!preview) {
                setFailed(true);
              }
            }
          }}
          onSaveSkip={async (next) => {
            try {
              return await saveSkip(next);
            } catch (error) {
              if (!preview) {
                setFailed(true);
              }

              throw error;
            }
          }}
          skipCompanies={skipCompanies}
        />

        <output
          aria-live="polite"
          className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-muted p-4"
        >
          <span
            className={`${dsMetric} text-signal-text tabular-nums`}
            data-testid="targets-match-count"
          >
            {String(matched)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{copy.onboarding.matchedLabel}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{copy.onboarding.matchedNote}</p>
          </div>
        </output>
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
