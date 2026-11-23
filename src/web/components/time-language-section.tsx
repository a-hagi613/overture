import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { fetchProfileSettings, saveProfileSettings } from "../lib/profile-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle } from "./ui/ds.ts";

const knownZones = [
  { label: copy.settings.timeZoneToronto, value: "America/Toronto" },
  { label: copy.settings.timeZoneVancouver, value: "America/Vancouver" },
  { label: copy.settings.timeZoneBerlin, value: "Europe/Berlin" },
] as const;

const languageChips = [
  { code: "en", label: copy.settings.languageEnglish },
  { code: "fr", label: copy.settings.languageFrench },
  { code: "de", label: copy.settings.languageGerman },
] as const;

function browserZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function zoneLabel(zone: string) {
  return knownZones.find((candidate) => candidate.value === zone)?.label ?? zone;
}

function zoneOptions(zones: (string | null)[]) {
  const options: { label: string; value: string }[] = knownZones.map((zone) => ({
    label: zone.label,
    value: zone.value,
  }));

  for (const zone of zones) {
    if (zone !== null && !options.some((option) => option.value === zone)) {
      options.push({ label: zoneLabel(zone), value: zone });
    }
  }

  return options;
}

export function TimeLanguageSection() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryFn: fetchProfileSettings,
    queryKey: ["profile-settings"],
  });

  const save = useMutation({
    mutationFn: saveProfileSettings,
    onError: () => {
      toast.error(copy.settings.notificationsSaveError);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["profile-settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["time-language"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-targets"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-targets-count"] });
      toast.success("Time and language updated.");
    },
  });

  const controlsDisabled = settingsQuery.isPending || save.isPending;

  const savedZone = settingsQuery.data?.timezone ?? null;
  const pendingZone = settingsQuery.data?.pendingTimezone ?? null;
  const zone = pendingZone ?? savedZone ?? browserZone();
  const languages = settingsQuery.data?.languages ?? [];

  function persist(nextLanguages: string[], nextZone: string) {
    save.mutate({ languages: nextLanguages, timezone: nextZone });
  }

  function toggleLanguage(code: string) {
    const next = languages.includes(code)
      ? languages.filter((candidate) => candidate !== code)
      : [...languages, code];

    persist(next, zone);
  }

  return (
    <Card
      ariaLabelledBy="settings-time-language"
      className="p-5 md:p-6"
      dataTestId="settings-time-language"
    >
      <h2 className={dsCardTitle} id="settings-time-language">
        {copy.settings.timeLanguageHeading}
      </h2>

      <div className="mt-4 divide-y divide-border">
        <div
          className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="settings-time-zone-row"
        >
          <div className="min-w-0 flex-1">
            <label
              className="block text-sm font-semibold text-foreground"
              htmlFor="settings-timezone"
            >
              {copy.settings.timeZoneLabel}
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">{copy.settings.timeZoneHint}</p>
          </div>

          <div className="relative w-full shrink-0 sm:w-56">
            <select
              className="h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3 pr-9 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50"
              disabled={controlsDisabled}
              id="settings-timezone"
              onChange={(event) => {
                persist(languages, event.currentTarget.value);
              }}
              value={zone}
            >
              {zoneOptions([browserZone(), savedZone, pendingZone]).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
          </div>
        </div>

        <div
          className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="settings-posting-languages-row"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground" id="settings-posting-languages">
              {copy.settings.languagesHeading}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{copy.settings.languagesHint}</p>
          </div>
          <fieldset
            aria-labelledby="settings-posting-languages"
            className="m-0 flex flex-wrap gap-2 border-0 p-0"
          >
            {languageChips.map((chip) => {
              const active = languages.includes(chip.code);

              return (
                <Button
                  ariaPressed={active}
                  className="rounded-full"
                  disabled={controlsDisabled}
                  key={chip.code}
                  onClick={() => {
                    toggleLanguage(chip.code);
                  }}
                  size="sm"
                  variant={active ? "primary" : "outline"}
                >
                  {chip.label}
                </Button>
              );
            })}
          </fieldset>
        </div>
      </div>

      {save.isError ? (
        <p className="mt-3 text-xs font-semibold text-need" role="alert">
          {copy.settings.notificationsSaveError}
        </p>
      ) : null}
    </Card>
  );
}
