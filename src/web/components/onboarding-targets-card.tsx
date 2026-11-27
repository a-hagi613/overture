import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type { OnboardingTargetChoices, OnboardingTargetsView } from "../../shared/onboarding.ts";
import type { PlaceSuggestion } from "../../shared/places.ts";
import type { RoleCategoryId } from "../../shared/role-taxonomy.ts";
import type { Seniority, Workplace } from "../../shared/tag-taxonomy.ts";
import type { TargetsInput } from "../../shared/targets.ts";
import type { SkipCompany } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import {
  DEFAULT_ONBOARDING_CATEGORY,
  ONBOARDING_SENIORITIES,
  onboardingCategoryForRole,
} from "../../shared/onboarding-options.ts";
import { OnboardingTargetChip } from "./onboarding-target-chip.tsx";
import { OnboardingTargetChipGroup } from "./onboarding-target-chip-group.tsx";
import { OnboardingTargetsLocations } from "./onboarding-targets-locations.tsx";
import { OnboardingTargetsOptional } from "./onboarding-targets-optional.tsx";
import { OnboardingTargetsRoles } from "./onboarding-targets-roles.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

const moneyFormat = new Intl.NumberFormat("en-US");

const seniorityLabels: Record<Seniority, string> = {
  director: "Director",
  entry: "Junior",
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

function initialCategoryFor(roles: readonly string[]) {
  const [first] = roles;

  return first === undefined ? DEFAULT_ONBOARDING_CATEGORY : onboardingCategoryForRole(first);
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
  backTo?: string | undefined;
  currentEmployer: string | null;
  onContinue: () => Promise<void> | void;
  preview?: boolean | undefined;
  save: (targets: TargetsInput) => Promise<OnboardingTargetsView>;
  saveCurrentEmployer: (name: string) => Promise<void> | void;
  saveSkip: (companies: { name: string; domain: string | null }[]) => Promise<{
    companies: SkipCompany[];
  }>;
  skipCompanies: SkipCompany[];
  view: OnboardingTargetsView;
}) {
  const [draft, setDraft] = useState<TargetsInput>(view.targets);
  const [places, setPlaces] = useState<PlaceSuggestion[]>(view.places);
  const [salary, setSalary] = useState(() => salaryText(view.targets.salaryFloorMinor));

  const [category, setCategory] = useState<RoleCategoryId>(() =>
    initialCategoryFor(view.targets.roles),
  );

  const [savedMatchedCount, setSavedMatchedCount] = useState<number | null>(null);
  const matchedCount = savedMatchedCount ?? view.matchedCount;
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
        setSavedMatchedCount(saved.matchedCount);
        setPlaces(saved.places);
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
  const workplaces = choicesWithSelected(choices.workplaces, draft.workplaces);
  const seniorities = choicesWithSelected(ONBOARDING_SENIORITIES, draft.seniorities);

  const complete =
    draft.roles.length > 0 &&
    draft.locations.length > 0 &&
    draft.workplaces.length > 0 &&
    draft.seniorities.length > 0;

  const commitSalary = (raw: string) => {
    const floor = floorFromInput(raw);

    void commit({
      ...draft,
      salaryCurrency: floor === null ? null : currency,
      salaryFloorMinor: floor,
    });
  };

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
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-7">
      <h2 className={dsCardTitle} id="ob-h">
        {copy.onboarding.wantTitlePlain}
      </h2>
      <p className={`${dsBody} mt-1.5 max-w-xl`}>{copy.onboarding.wantIntro}</p>

      <div className="mt-6 space-y-5">
        <OnboardingTargetsRoles
          category={category}
          onCategoryChange={setCategory}
          onToggleRole={(role) => {
            void commit({ ...draft, roles: toggle(draft.roles, role) });
          }}
          roleCounts={choices.roleCounts}
          selectedRoles={draft.roles}
        />

        <OnboardingTargetsLocations
          onPickLocation={(place) => {
            if (draft.locations.includes(place.id)) {
              return;
            }

            setPlaces((current) =>
              current.some((candidate) => candidate.id === place.id)
                ? current
                : [...current, place],
            );
            void commit({ ...draft, locations: [...draft.locations, place.id] });
          }}
          onRemoveLocation={(id) => {
            void commit({
              ...draft,
              locations: draft.locations.filter((candidate) => candidate !== id),
            });
          }}
          places={places}
          selectedLocations={draft.locations}
        />

        <div className="border-t border-border pt-5">
          <OnboardingTargetChipGroup
            headingId="w-work"
            label={copy.onboarding.workplace}
            note={copy.onboarding.atLeastOne}
          >
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
        </div>

        <div className="border-t border-border pt-5">
          <OnboardingTargetChipGroup
            headingId="w-sen"
            label={copy.onboarding.seniority}
            note={copy.onboarding.atLeastOne}
          >
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

        <OnboardingTargetsOptional
          currentEmployer={currentEmployer}
          onCommitSalary={commitSalary}
          onSalaryChange={setSalary}
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
          salary={salary}
          skipCompanies={skipCompanies}
        />
      </div>

      {failed ? (
        <p className="mt-4 text-xs font-semibold text-need" role="alert">
          {copy.onboarding.saveFailed}
        </p>
      ) : null}

      <p
        aria-live="polite"
        className="mt-6 text-sm text-muted-foreground"
        data-testid="onboarding-targets-status"
      >
        {complete ? copy.onboarding.matchedCount(matchedCount) : copy.onboarding.pickEveryGroup}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button asChild size="default" variant="ghost">
          <Link to={backTo}>
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{copy.onboarding.back}</span>
          </Link>
        </Button>
        <Button
          ariaBusy={continuing}
          disabled={continuing || !complete}
          onClick={() => {
            void continueOn();
          }}
          size="lg"
          variant="primary"
        >
          <span>{copy.onboarding.seeMatches}</span>
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </Card>
  );
}
