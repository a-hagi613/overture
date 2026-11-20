import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { copy } from "../../shared/copy.ts";
import { FilterChip } from "./filter-chip.tsx";
import { fetchProfileSettings, saveProfileSettings } from "../lib/profile-api.ts";

const knownZones = [
  { value: "America/Toronto", label: copy.settings.timeZoneToronto },
  { value: "America/Vancouver", label: copy.settings.timeZoneVancouver },
  { value: "Europe/Berlin", label: copy.settings.timeZoneBerlin },
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

function zoneOptions(savedZone: string | null, browserZoneValue: string) {
  const options: { label: string; value: string }[] = knownZones.map((zone) => ({
    label: zone.label,
    value: zone.value,
  }));

  for (const zone of [browserZoneValue, savedZone]) {
    if (zone !== null && !options.some((option) => option.value === zone)) {
      options.push({ label: zoneLabel(zone), value: zone });
    }
  }

  return options;
}

export function TimeLanguageSection() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["profile-settings"],
    queryFn: fetchProfileSettings,
  });

  const save = useMutation({
    mutationFn: saveProfileSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(["profile-settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["profile-targets"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-targets-count"] });
    },
  });

  const savedZone = settingsQuery.data?.timezone ?? null;
  const zone = savedZone ?? browserZone();
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
    <section
      aria-labelledby="settings-time-language"
      className="flex flex-col rounded-lg border border-border bg-card p-[20px_16px_22px] shadow-sh min-[768px]:p-[24px_28px_26px]"
      data-testid="settings-time-language"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <h2
          className="font-serif text-[28px] leading-[1.1] tracking-[-0.005em]"
          id="settings-time-language"
        >
          {copy.settings.timeLanguageHeading}
        </h2>
        <span className="font-serif text-sm leading-[1.5] italic text-muted-foreground">
          {copy.settings.timeLanguageFolio}
        </span>
      </div>
      <div className="mt-2.5">
        <div
          className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 py-3.5"
          data-testid="settings-time-zone-row"
        >
          <div className="min-w-0 flex-[1_1_240px]">
            <label
              className="block text-sm font-semibold leading-[1.4]"
              htmlFor="settings-timezone"
            >
              {copy.settings.timeZoneLabel}
            </label>
            <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
              {copy.settings.timeZoneHint}
            </p>
          </div>
          <div className="relative h-10 w-[230px] flex-none max-[767px]:h-12">
            <select
              className="h-full w-full appearance-none rounded-md border border-input bg-card pl-3 pr-9 text-[13.5px] font-medium leading-[normal] text-foreground focus-visible:ring-2 focus-visible:ring-foreground"
              id="settings-timezone"
              onChange={(event) => {
                persist(languages, event.currentTarget.value);
              }}
              value={zone}
            >
              {zoneOptions(savedZone, browserZone()).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute right-[11px] top-3 text-muted-foreground max-[767px]:top-4"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              width="16"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
        <div
          className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-t border-border py-3.5"
          data-testid="settings-posting-languages-row"
        >
          <div className="min-w-0 flex-[1_1_240px]">
            <p className="text-sm font-semibold leading-[1.4]" id="settings-posting-languages">
              {copy.settings.languagesHeading}
            </p>
            <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
              {copy.settings.languagesHint}
            </p>
          </div>
          <fieldset
            aria-labelledby="settings-posting-languages"
            className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          >
            {languageChips.map((chip) => (
              <FilterChip
                key={chip.code}
                on={languages.includes(chip.code)}
                onClick={() => toggleLanguage(chip.code)}
              >
                {chip.label}
              </FilterChip>
            ))}
          </fieldset>
        </div>
      </div>
    </section>
  );
}
