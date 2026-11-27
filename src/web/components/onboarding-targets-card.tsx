import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type { OnboardingTargetsView } from "../../shared/onboarding.ts";
import type { PlaceSuggestion } from "../../shared/places.ts";
import type { TargetsInput } from "../../shared/targets.ts";
import type { SkipCompany } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import { OnboardingBlockedEmployers } from "./onboarding-blocked-employers.tsx";
import { OnboardingTargetsLocations } from "./onboarding-targets-locations.tsx";
import { RoleTargetsEditor } from "./role-targets-editor.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

function toggleCategory(roles: readonly string[], categoryId: string) {
  return roles.includes(categoryId)
    ? roles.filter((role) => role !== categoryId)
    : [...roles, categoryId];
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
  const [savedMatchedCount, setSavedMatchedCount] = useState<number | null>(null);
  const matchedCount = savedMatchedCount ?? view.matchedCount;
  const [failed, setFailed] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const sequence = useRef(0);

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

  const complete = draft.roles.length > 0 && draft.locations.length > 0;

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
        <RoleTargetsEditor
          idPrefix="onboarding"
          onAddCategory={(categoryId) => {
            void commit({ ...draft, roles: toggleCategory(draft.roles, categoryId) });
          }}
          onAddTitleWord={(word) => {
            void commit({
              ...draft,
              roles: draft.roles.includes(word) ? draft.roles : [...draft.roles, word],
            });
          }}
          onDismissRole={(role) => {
            void commit({
              ...draft,
              unresolvedRoles: draft.unresolvedRoles.filter((candidate) => candidate !== role),
            });
          }}
          onRemoveCategory={(categoryId) => {
            void commit({ ...draft, roles: draft.roles.filter((role) => role !== categoryId) });
          }}
          onRemoveTitleWord={(word) => {
            void commit({ ...draft, roles: draft.roles.filter((role) => role !== word) });
          }}
          onResolveRole={(role, categoryId) => {
            void commit({
              ...draft,
              roles: draft.roles.includes(categoryId) ? draft.roles : [...draft.roles, categoryId],
              unresolvedRoles: draft.unresolvedRoles.filter((candidate) => candidate !== role),
            });
          }}
          roles={draft.roles}
          unresolvedRoles={draft.unresolvedRoles}
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
        </div>
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
