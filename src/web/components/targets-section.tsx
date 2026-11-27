import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { PlaceSuggestion } from "../../shared/places.ts";
import type { TargetsInput } from "../../shared/targets.ts";
import { copy } from "../../shared/copy.ts";
import { placeFallbackLabel } from "../../shared/places.ts";
import {
  fetchSkipCompanies,
  fetchTargets,
  previewTargetsCount,
  saveSkipCompanies,
  saveTargets,
} from "../lib/profile-api.ts";
import { RoleTargetsEditor } from "./role-targets-editor.tsx";
import { SectionSkeleton } from "./section-skeleton.tsx";
import { SourceChip } from "./source-chip.tsx";
import { UnresolvedPlaceRow } from "./unresolved-place-row.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow, dsMetric } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";
import { PlacePicker } from "./ui/place-picker.tsx";

function toggleCategory(roles: readonly string[], categoryId: string) {
  return roles.includes(categoryId)
    ? roles.filter((role) => role !== categoryId)
    : [...roles, categoryId];
}

export function TargetsSection() {
  const { targets } = copy.profile;
  const queryClient = useQueryClient();

  const targetsQuery = useQuery({
    queryFn: fetchTargets,
    queryKey: ["profile-targets"],
  });

  const companiesQuery = useQuery({
    queryFn: fetchSkipCompanies,
    queryKey: ["profile-skip-companies"],
  });

  const [savedDraft, setSavedDraft] = useState<TargetsInput | null>(null);
  const [pickedPlaces, setPickedPlaces] = useState<PlaceSuggestion[]>([]);
  const [companyName, setCompanyName] = useState("");
  const draft = savedDraft ?? targetsQuery.data?.targets ?? null;

  const countQuery = useQuery({
    enabled: draft !== null,
    queryFn: async () => {
      if (draft === null) {
        return { matchedCount: 0 };
      }

      return previewTargetsCount(draft);
    },
    queryKey: ["profile-targets-count", draft],
  });

  const save = useMutation({
    mutationFn: saveTargets,
    onSuccess: (saved) => {
      setSavedDraft(saved.targets);
      queryClient.setQueryData(["profile-targets"], saved);
      void queryClient.invalidateQueries({ queryKey: ["profile-targets-count"] });
      toast.success(copy.profileWorkspace.targetsSavedToast);
    },
  });

  const saveSkip = useMutation({
    mutationFn: saveSkipCompanies,
    onSuccess: (saved) => {
      queryClient.setQueryData(["profile-skip-companies"], saved);
      toast.success(copy.profileWorkspace.skipListSavedToast);
    },
  });

  const matchedCount = countQuery.data?.matchedCount ?? targetsQuery.data?.matchedCount ?? 0;

  const placeById = new Map(
    [...(targetsQuery.data?.places ?? []), ...pickedPlaces].map((place) => [place.id, place]),
  );

  const labelOf = (id: string) => placeById.get(id)?.label ?? placeFallbackLabel(id);

  const companies = companiesQuery.data?.companies ?? [];
  const currentEmployer = companies.find((company) => company.reason === "current_employer");
  const userCompanies = companies.filter((company) => company.reason === "user");

  function update(patch: Partial<TargetsInput>) {
    if (draft !== null) {
      setSavedDraft({ ...draft, ...patch });
    }
  }

  function persistEmployers(names: string[]) {
    saveSkip.mutate(
      names.map((name) => ({ domain: null, name })),
      {
        onError: () => {
          toast.error(copy.profile.saveFailed);
        },
      },
    );
  }

  function addCompany() {
    const name = companyName.trim();

    if (name === "" || saveSkip.isPending) {
      return;
    }

    persistEmployers([...userCompanies.map((company) => company.name), name]);
    setCompanyName("");
  }

  function rememberPlace(place: PlaceSuggestion) {
    setPickedPlaces((current) =>
      current.some((candidate) => candidate.id === place.id) ? current : [...current, place],
    );
  }

  function addPickedPlace(place: PlaceSuggestion) {
    if (draft === null) {
      return;
    }

    rememberPlace(place);

    if (!draft.locations.includes(place.id)) {
      update({ locations: [...draft.locations, place.id] });
    }
  }

  function resolveUnresolved(raw: string, place: PlaceSuggestion) {
    if (draft === null) {
      return;
    }

    rememberPlace(place);
    update({
      locations: draft.locations.includes(place.id)
        ? draft.locations
        : [...draft.locations, place.id],
      unresolvedLocations: draft.unresolvedLocations.filter((candidate) => candidate !== raw),
    });
  }

  const limiting =
    (draft?.roles.length ?? 0) === 0
      ? { href: "#profile-target-roles", text: targets.countZeroRoles }
      : { href: "#profile-target-locations", text: targets.countZeroLocations };

  if (targetsQuery.isPending) {
    return <SectionSkeleton />;
  }

  return (
    <Card ariaLabelledBy="profile-targets-heading" className="p-5 md:p-6" id="profile-targets">
      <h2 className={dsCardTitle} id="profile-targets-heading">
        {`${targets.titlePlain} ${targets.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{targets.intro}</p>

      <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/40 p-4">
        <span
          className={`${dsMetric} leading-none text-signal-text`}
          data-testid="targets-matched-count"
        >
          {matchedCount}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{targets.matchedLabel}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{targets.matchedNote}</p>
        </div>
      </div>

      {matchedCount === 0 && draft !== null ? (
        <output className="mt-3 block rounded-lg border border-border bg-card p-3">
          <p className="text-sm font-semibold text-foreground">{targets.countZero}</p>
          <a
            className="mt-1 inline-block text-sm font-semibold text-signal-text underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            href={limiting.href}
          >
            {limiting.text}
          </a>
        </output>
      ) : null}

      <section className="mt-5 border-t border-border py-5" id="profile-target-roles">
        <RoleTargetsEditor
          idPrefix="profile"
          onAddCategory={(categoryId) => {
            if (draft !== null) {
              update({ roles: toggleCategory(draft.roles, categoryId) });
            }
          }}
          onAddTitleWord={(word) => {
            if (draft !== null && !draft.roles.includes(word)) {
              update({ roles: [...draft.roles, word] });
            }
          }}
          onDismissRole={(role) => {
            if (draft !== null) {
              update({
                unresolvedRoles: draft.unresolvedRoles.filter((candidate) => candidate !== role),
              });
            }
          }}
          onRemoveCategory={(categoryId) => {
            if (draft !== null) {
              update({ roles: draft.roles.filter((role) => role !== categoryId) });
            }
          }}
          onRemoveTitleWord={(word) => {
            if (draft !== null) {
              update({ roles: draft.roles.filter((role) => role !== word) });
            }
          }}
          onResolveRole={(role, categoryId) => {
            if (draft === null) {
              return;
            }

            update({
              roles: draft.roles.includes(categoryId) ? draft.roles : [...draft.roles, categoryId],
              unresolvedRoles: draft.unresolvedRoles.filter((candidate) => candidate !== role),
            });
          }}
          roles={draft?.roles ?? []}
          unresolvedRoles={draft?.unresolvedRoles ?? []}
        />
      </section>

      <section className="border-t border-border py-5" id="profile-target-locations">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={dsEyebrow} id="profile-target-locations-heading">
            {targets.locations}
          </h3>
          <span className="text-xs font-semibold text-muted-foreground">{targets.required}</span>
        </div>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{targets.locationsNote}</p>

        <ul
          aria-labelledby="profile-target-locations-heading"
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          {(draft?.locations ?? []).map((location) => (
            <li key={location}>
              <Button
                ariaLabel={targets.removeLocation(labelOf(location))}
                className="rounded-full"
                onClick={() => {
                  update({
                    locations: (draft?.locations ?? []).filter(
                      (candidate) => candidate !== location,
                    ),
                  });
                }}
                size="sm"
                variant="secondary"
              >
                <span>{labelOf(location)}</span>
                <X aria-hidden="true" size={13} />
              </Button>
            </li>
          ))}
          <li>
            <PlacePicker
              excludeIds={draft?.locations ?? []}
              id="profile-target-location"
              noResults={targets.locationNoResults}
              onPick={addPickedPlace}
              placeholder={targets.pickLocationPlaceholder}
              triggerLabel={targets.addLocation}
            />
          </li>
        </ul>

        {(draft?.unresolvedLocations ?? []).length === 0 ? null : (
          <section
            aria-labelledby="profile-target-unresolved"
            className="mt-4 rounded-lg border border-border bg-muted/40 p-3"
          >
            <p className={dsEyebrow} id="profile-target-unresolved">
              {targets.unresolvedTitle}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{targets.unresolvedNote}</p>
            <ul className="mt-3 space-y-2">
              {(draft?.unresolvedLocations ?? []).map((raw, index) => (
                <UnresolvedPlaceRow
                  dismissLabel={targets.dismissLocation(raw)}
                  id={`profile-unresolved-${String(index)}`}
                  key={raw}
                  noResults={targets.locationNoResults}
                  onDismiss={() => {
                    update({
                      unresolvedLocations: (draft?.unresolvedLocations ?? []).filter(
                        (candidate) => candidate !== raw,
                      ),
                    });
                  }}
                  onPick={(place) => {
                    resolveUnresolved(raw, place);
                  }}
                  placeholder={targets.pickLocationPlaceholder}
                  raw={raw}
                  triggerLabel={targets.pickUnresolved}
                />
              ))}
            </ul>
          </section>
        )}
      </section>

      <section className="border-t border-border py-5">
        <h3 className={dsEyebrow}>{targets.employers}</h3>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{targets.employersNote}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {currentEmployer === undefined ? null : (
            <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-muted px-3.5 text-xs font-semibold text-foreground">
              <span>{currentEmployer.name}</span>
              <SourceChip variant="dashed">{targets.currentEmployer}</SourceChip>
            </span>
          )}
          {userCompanies.map((company) => (
            <Button
              ariaLabel={copy.profile.facts.remove(company.name)}
              className="rounded-full"
              disabled={saveSkip.isPending}
              key={company.id}
              onClick={() => {
                persistEmployers(
                  userCompanies
                    .filter((candidate) => candidate.id !== company.id)
                    .map((candidate) => candidate.name),
                );
              }}
              size="sm"
              variant="secondary"
            >
              <span>{company.name}</span>
              <X aria-hidden="true" size={13} />
            </Button>
          ))}
          {currentEmployer === undefined && userCompanies.length === 0 ? (
            <p className="text-xs text-muted-foreground">{targets.noExcludedEmployers}</p>
          ) : null}
        </div>

        <form
          className="mt-3 flex max-w-md flex-wrap items-center gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            addCompany();
          }}
        >
          <Input
            ariaLabel={targets.addCompanyLabel}
            className="min-w-44 flex-1"
            onChange={(event) => {
              setCompanyName(event.currentTarget.value);
            }}
            placeholder={targets.addCompanyLabel}
            value={companyName}
          />
          <Button disabled={saveSkip.isPending} size="default" submit variant="secondary">
            <Plus aria-hidden="true" size={15} />
            <span>{targets.addCompany}</span>
          </Button>
        </form>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button
          disabled={draft === null || save.isPending}
          onClick={() => {
            if (draft !== null) {
              save.mutate(draft, {
                onError: () => {
                  toast.error(copy.profile.saveFailed);
                },
              });
            }
          }}
          size="default"
          variant="primary"
        >
          <Check aria-hidden="true" size={15} />
          <span>{targets.submit}</span>
        </Button>
        <p className="text-xs text-muted-foreground">{targets.submitNote}</p>
      </div>
    </Card>
  );
}
