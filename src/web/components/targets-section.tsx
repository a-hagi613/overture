import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { TargetsInput } from "../../shared/targets.ts";

import { copy } from "../../shared/copy.ts";
import { AddChip } from "./add-chip.tsx";
import { ChoiceChip } from "./choice-chip.tsx";
import { FilterChip } from "./filter-chip.tsx";
import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { fetchTargets, previewTargetsCount, saveTargets } from "../lib/profile-api.ts";

const moneyFormat = new Intl.NumberFormat("en-US");

const workplaceChips = [
  { value: "remote", label: copy.profile.targets.remote },
  { value: "hybrid", label: copy.profile.targets.hybrid },
  { value: "onsite", label: copy.profile.targets.onSite },
] as const;

const seniorityChips = [
  { value: "mid", label: copy.profile.targets.mid },
  { value: "senior", label: copy.profile.targets.senior },
  { value: "staff", label: copy.profile.targets.staff },
  { value: "principal", label: copy.profile.targets.lead },
] as const;

const employmentChips = [
  { value: "full_time", label: copy.profile.targets.fullTime },
  { value: "part_time", label: copy.profile.targets.partTime },
  { value: "contract", label: copy.profile.targets.contract },
] as const;

const currencyOptions = ["CAD", "USD"] as const;

function toggleValue<T extends string>(values: readonly T[], value: T) {
  if (values.includes(value)) {
    return values.filter((candidate) => candidate !== value);
  }

  return [...values, value];
}

function salaryValue(floorMinor: number | null) {
  return floorMinor === null ? "" : moneyFormat.format(floorMinor / 100);
}

function floorFromInput(raw: string) {
  const digits = raw.replaceAll(/[^0-9]/gu, "");

  return digits === "" ? null : Number(digits) * 100;
}

function saveButtonLook() {
  return "inline-flex min-h-11 items-center gap-2 rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] leading-[normal] font-semibold text-btn-ink shadow-[inset_0_1px_0_rgba(255,255,255,.14)] hover:bg-btn-hover max-[767px]:min-h-12 max-[767px]:flex-[1_1_100%]";
}

export function TargetsSection() {
  const { targets } = copy.profile;
  const queryClient = useQueryClient();

  const targetsQuery = useQuery({
    queryKey: ["profile-targets"],
    queryFn: fetchTargets,
  });

  const [savedDraft, setSavedDraft] = useState<TargetsInput | null>(null);
  const draft = savedDraft ?? targetsQuery.data?.targets ?? null;

  const countQuery = useQuery({
    queryKey: ["profile-targets-count", draft],
    queryFn: async () => {
      if (draft === null) {
        return { matchedCount: 0 };
      }

      return previewTargetsCount(draft);
    },
    enabled: draft !== null,
  });

  const save = useMutation({
    mutationFn: saveTargets,
    onSuccess: (saved) => {
      setSavedDraft(saved.targets);
      queryClient.setQueryData(["profile-targets"], saved);
      void queryClient.invalidateQueries({ queryKey: ["profile-targets-count"] });
    },
  });

  const [newRole, setNewRole] = useState<string | null>(null);
  const [newLocation, setNewLocation] = useState<string | null>(null);

  const matchedCount = countQuery.data?.matchedCount ?? targetsQuery.data?.matchedCount ?? 0;

  function update(patch: Partial<TargetsInput>) {
    if (draft !== null) {
      setSavedDraft({ ...draft, ...patch });
    }
  }

  function addRole() {
    if (draft === null || newRole === null) {
      return;
    }

    const role = newRole.trim();

    if (role !== "" && !draft.roles.includes(role)) {
      update({ roles: [...draft.roles, role] });
    }

    setNewRole(null);
  }

  function addLocation() {
    if (draft === null || newLocation === null) {
      return;
    }

    const location = newLocation.trim();

    if (location !== "" && !draft.locations.includes(location)) {
      update({ locations: [...draft.locations, location] });
    }

    setNewLocation(null);
  }

  return (
    <Section id="profile-targets" labelledBy="profile-targets-heading">
      <SectionHead
        folio={targets.folio}
        headingId="profile-targets-heading"
        intro={targets.intro}
        title={
          <>
            {targets.titlePlain} <span className="italic">{targets.titleItalic}</span>
          </>
        }
      />
      <div className="mt-[18px] flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-lg border border-border bg-muted p-4 px-[18px]">
        <span
          className="font-serif text-[52px] leading-none tabular-nums"
          data-testid="targets-matched-count"
        >
          {matchedCount}
        </span>
        <div className="min-w-0 flex-[1_1_240px]">
          <p className="text-[14.5px] font-semibold">{targets.matchedLabel}</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{targets.matchedNote}</p>
        </div>
      </div>
      <div className="mt-[18px] border-t border-border pb-[18px] pt-[18px]">
        <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.roles}</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(draft?.roles ?? []).map((role) => (
            <ChoiceChip
              key={role}
              onRemove={() => {
                update({ roles: (draft?.roles ?? []).filter((candidate) => candidate !== role) });
              }}
              removeLabel={copy.profile.facts.remove(role)}
            >
              {role}
            </ChoiceChip>
          ))}
          {newRole === null ? (
            <AddChip onClick={() => setNewRole("")}>{targets.addRole}</AddChip>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                addRole();
              }}
            >
              <input
                aria-label={targets.addRole}
                className="h-9 w-[200px] rounded-md border border-input bg-card px-3 text-[13.5px] font-medium"
                onChange={(event) => setNewRole(event.currentTarget.value)}
                value={newRole}
              />
              <button
                className="min-h-9 rounded-md border border-input bg-card px-3 text-[13px] font-semibold"
                type="submit"
              >
                {targets.add}
              </button>
            </form>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-10">
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.locations}</h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(draft?.locations ?? []).map((location) => (
              <ChoiceChip
                key={location}
                onRemove={() => {
                  update({
                    locations: (draft?.locations ?? []).filter(
                      (candidate) => candidate !== location,
                    ),
                  });
                }}
                removeLabel={copy.profile.facts.remove(location)}
              >
                {location}
              </ChoiceChip>
            ))}
            {newLocation === null ? (
              <AddChip onClick={() => setNewLocation("")}>{targets.addLocation}</AddChip>
            ) : (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  addLocation();
                }}
              >
                <input
                  aria-label={targets.addLocation}
                  className="h-9 w-[200px] rounded-md border border-input bg-card px-3 text-[13.5px] font-medium"
                  onChange={(event) => setNewLocation(event.currentTarget.value)}
                  value={newLocation}
                />
                <button
                  className="min-h-9 rounded-md border border-input bg-card px-3 text-[13px] font-semibold"
                  type="submit"
                >
                  {targets.add}
                </button>
              </form>
            )}
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.workplace}</h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {workplaceChips.map((chip) => (
              <FilterChip
                key={chip.value}
                on={(draft?.workplaces ?? []).includes(chip.value)}
                onClick={() => {
                  if (draft !== null) {
                    update({ workplaces: toggleValue(draft.workplaces, chip.value) });
                  }
                }}
              >
                {chip.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">{targets.seniority}</h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {seniorityChips.map((chip) => (
              <FilterChip
                key={chip.value}
                on={(draft?.seniorities ?? []).includes(chip.value)}
                onClick={() => {
                  if (draft !== null) {
                    update({ seniorities: toggleValue(draft.seniorities, chip.value) });
                  }
                }}
              >
                {chip.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <h3 className="mb-0 text-[12.5px] font-semibold leading-[normal]">
            {targets.employmentType}
          </h3>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {employmentChips.map((chip) => (
              <FilterChip
                key={chip.value}
                on={(draft?.employmentTypes ?? []).includes(chip.value)}
                onClick={() => {
                  if (draft !== null) {
                    update({
                      employmentTypes: toggleValue(draft.employmentTypes, chip.value),
                    });
                  }
                }}
              >
                {chip.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="border-t border-border pb-[18px] pt-[18px]">
          <label
            className="mb-2 block text-[12.5px] font-semibold leading-[normal]"
            htmlFor="ovt-salary"
          >
            {targets.salaryFloor}
          </label>
          <div className="flex max-w-[380px] items-center gap-2.5">
            <select
              aria-label={targets.currencyLabel}
              className="h-10 w-24 flex-none appearance-none rounded-md border border-input bg-card px-3 pr-9 text-[13.5px] font-medium max-[767px]:h-11"
              onChange={(event) => {
                update({ salaryCurrency: event.currentTarget.value });
              }}
              value={draft?.salaryCurrency ?? "CAD"}
            >
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency === "CAD" ? targets.currencyCad : targets.currencyUsd}
                </option>
              ))}
            </select>
            <input
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-0 text-[13.5px] leading-[normal] font-medium tabular-nums max-[767px]:h-11"
              id="ovt-salary"
              inputMode="numeric"
              onChange={(event) => {
                update({ salaryFloorMinor: floorFromInput(event.currentTarget.value) });
              }}
              value={salaryValue(draft?.salaryFloorMinor ?? null)}
            />
            <span className="flex-none text-[12.5px] text-muted-foreground">
              {targets.salaryFloorUnit}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{targets.salaryFloorNote}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-[18px]">
        <button
          className={saveButtonLook()}
          disabled={draft === null || save.isPending}
          onClick={() => {
            if (draft !== null) {
              save.mutate(draft);
            }
          }}
          type="button"
        >
          {targets.submit}
        </button>
        <p className="text-[12.5px] text-muted-foreground max-[767px]:min-h-12 max-[767px]:flex-[1_1_100%]">
          {targets.submitNote}
        </p>
      </div>
    </Section>
  );
}
