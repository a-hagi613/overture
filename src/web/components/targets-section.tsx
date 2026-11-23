import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { TargetsInput } from "../../shared/targets.ts";

import { copy } from "../../shared/copy.ts";
import { fetchTargets, previewTargetsCount, saveTargets } from "../lib/profile-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

const moneyFormat = new Intl.NumberFormat("en-US");

const workplaceChips = [
  { label: copy.profile.targets.remote, value: "remote" },
  { label: copy.profile.targets.hybrid, value: "hybrid" },
  { label: copy.profile.targets.onSite, value: "onsite" },
] as const;

const seniorityChips = [
  { label: copy.profile.targets.mid, value: "mid" },
  { label: copy.profile.targets.senior, value: "senior" },
  { label: copy.profile.targets.staff, value: "staff" },
  { label: copy.profile.targets.lead, value: "principal" },
] as const;

const employmentChips = [
  { label: copy.profile.targets.fullTime, value: "full_time" },
  { label: copy.profile.targets.partTime, value: "part_time" },
  { label: copy.profile.targets.contract, value: "contract" },
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

export function TargetsSection() {
  const { targets } = copy.profile;
  const queryClient = useQueryClient();

  const targetsQuery = useQuery({
    queryFn: fetchTargets,
    queryKey: ["profile-targets"],
  });

  const [savedDraft, setSavedDraft] = useState<TargetsInput | null>(null);
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
      toast.success("Job preferences saved.");
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
    <Card ariaLabelledBy="profile-targets-heading" className="mt-6 p-5 md:p-6" id="profile-targets">
      <h2 className={dsCardTitle} id="profile-targets-heading">
        {`${targets.titlePlain} ${targets.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{targets.intro}</p>

      <Card className="mt-5 flex flex-wrap items-center gap-4 p-4 shadow-none" variant="muted">
        <span
          className="font-serif text-metric leading-none text-signal-text tabular-nums"
          data-testid="targets-matched-count"
        >
          {matchedCount}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{targets.matchedLabel}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{targets.matchedNote}</p>
        </div>
      </Card>

      <div className="mt-5 border-t border-border py-5">
        <h3 className={dsEyebrow}>{targets.roles}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(draft?.roles ?? []).map((role) => (
            <Button
              ariaLabel={copy.profile.facts.remove(role)}
              className="rounded-full"
              key={role}
              onClick={() => {
                update({ roles: (draft?.roles ?? []).filter((candidate) => candidate !== role) });
              }}
              size="sm"
              variant="secondary"
            >
              <span>{role}</span>
              <X aria-hidden="true" size={13} />
            </Button>
          ))}
          {newRole === null ? (
            <Button
              className="rounded-full"
              onClick={() => {
                setNewRole("");
              }}
              size="sm"
              variant="outline"
            >
              <Plus aria-hidden="true" size={14} />
              <span>{targets.addRole}</span>
            </Button>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addRole();
              }}
            >
              <Input
                ariaLabel={targets.addRole}
                className="h-9 w-52 text-xs"
                onChange={(event) => {
                  setNewRole(event.currentTarget.value);
                }}
                value={newRole}
              />
              <Button size="sm" submit variant="secondary">
                {targets.add}
              </Button>
            </form>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <div className="border-t border-border py-5">
          <h3 className={dsEyebrow}>{targets.locations}</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(draft?.locations ?? []).map((location) => (
              <Button
                ariaLabel={copy.profile.facts.remove(location)}
                className="rounded-full"
                key={location}
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
                <span>{location}</span>
                <X aria-hidden="true" size={13} />
              </Button>
            ))}
            {newLocation === null ? (
              <Button
                className="rounded-full"
                onClick={() => {
                  setNewLocation("");
                }}
                size="sm"
                variant="outline"
              >
                <Plus aria-hidden="true" size={14} />
                <span>{targets.addLocation}</span>
              </Button>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addLocation();
                }}
              >
                <Input
                  ariaLabel={targets.addLocation}
                  className="h-9 w-52 text-xs"
                  onChange={(event) => {
                    setNewLocation(event.currentTarget.value);
                  }}
                  value={newLocation}
                />
                <Button size="sm" submit variant="secondary">
                  {targets.add}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="border-t border-border py-5">
          <h3 className={dsEyebrow}>{targets.workplace}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {workplaceChips.map((chip) => {
              const active = (draft?.workplaces ?? []).includes(chip.value);

              return (
                <Button
                  ariaPressed={active}
                  className="rounded-full"
                  key={chip.value}
                  onClick={() => {
                    if (draft !== null) {
                      update({ workplaces: toggleValue(draft.workplaces, chip.value) });
                    }
                  }}
                  size="sm"
                  variant={active ? "primary" : "outline"}
                >
                  {chip.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border py-5">
          <h3 className={dsEyebrow}>{targets.seniority}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {seniorityChips.map((chip) => {
              const active = (draft?.seniorities ?? []).includes(chip.value);

              return (
                <Button
                  ariaPressed={active}
                  className="rounded-full"
                  key={chip.value}
                  onClick={() => {
                    if (draft !== null) {
                      update({ seniorities: toggleValue(draft.seniorities, chip.value) });
                    }
                  }}
                  size="sm"
                  variant={active ? "primary" : "outline"}
                >
                  {chip.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border py-5">
          <h3 className={dsEyebrow}>{targets.employmentType}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {employmentChips.map((chip) => {
              const active = (draft?.employmentTypes ?? []).includes(chip.value);

              return (
                <Button
                  ariaPressed={active}
                  className="rounded-full"
                  key={chip.value}
                  onClick={() => {
                    if (draft !== null) {
                      update({ employmentTypes: toggleValue(draft.employmentTypes, chip.value) });
                    }
                  }}
                  size="sm"
                  variant={active ? "primary" : "outline"}
                >
                  {chip.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border py-5 md:col-span-2">
          <label className={`${dsEyebrow} block`} htmlFor="ovt-salary">
            {targets.salaryFloor}
          </label>
          <div className="mt-3 flex max-w-md items-center gap-2.5">
            <select
              aria-label={targets.currencyLabel}
              className="h-10 w-24 shrink-0 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
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
            <Input
              className="h-10 flex-1 tabular-nums"
              id="ovt-salary"
              onChange={(event) => {
                update({ salaryFloorMinor: floorFromInput(event.currentTarget.value) });
              }}
              value={salaryValue(draft?.salaryFloorMinor ?? null)}
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {targets.salaryFloorUnit}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{targets.salaryFloorNote}</p>
        </div>
      </div>

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
