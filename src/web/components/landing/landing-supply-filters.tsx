import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { RoleGroup } from "../../../shared/tag-taxonomy.ts";
import type { ComboboxOption } from "../ui/combobox.tsx";

import { escoGranularRolesFor } from "../../../shared/esco-roles.ts";
import { ROLE_GROUPS } from "../../../shared/tag-taxonomy.ts";
import { useLocationSuggestions } from "../../lib/supply-api.ts";
import { Combobox } from "../ui/combobox.tsx";
import { dsEyebrow } from "../ui/ds.ts";
import { RolePicker } from "../ui/role-picker.tsx";
import { Switch } from "../ui/switch.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

/**
 * The landing supply preview's filters: Level-1 ESCO category select, searchable Level-2 role
 * picker, debounced global GeoNames location combobox, and remote-only toggle built on shared
 * UI primitives.
 * @param props Current filter selections and change handlers.
 * @param props.category The chosen Level-1 category, or null for every category.
 * @param props.granularRole The chosen Level-2 ESCO role, or null for any role.
 * @param props.location Currently selected city, country, metro, region, or continent, or null.
 * @param props.onCategoryChange Called with the chosen category, or null for all categories.
 * @param props.onGranularRoleChange Called with the chosen granular role, or null for any role.
 * @param props.onLocationSelect Called with the selected location string or null when cleared.
 * @param props.onRemoteChange Called when the remote-only switch changes.
 * @param props.remote Whether the remote-only switch is on.
 * @returns The filter controls inside the Live Jobs card.
 */
export function LandingSupplyFilters({
  category,
  granularRole,
  location,
  onCategoryChange,
  onGranularRoleChange,
  onLocationSelect,
  onRemoteChange,
  remote,
}: {
  category: RoleGroup | null;
  granularRole: string | null;
  location: string | null;
  onCategoryChange: (value: RoleGroup | null) => void;
  onGranularRoleChange: (value: string | null) => void;
  onLocationSelect: (value: string | null) => void;
  onRemoteChange: (value: boolean) => void;
  remote: boolean;
}) {
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");

  const { loading: suggestionsLoading, suggestions } = useLocationSuggestions(
    locationSearch,
    locationOpen,
  );

  const roleOptions = escoGranularRolesFor(category).map((option) => ({
    hint: option.category,
    value: option.role,
  }));

  const locationOptions: readonly ComboboxOption[] = suggestions.map((item) => ({
    label: item.label,
    meta: item.meta,
    value: item.value,
  }));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:items-end">
      <div>
        <label className={`${dsEyebrow} block`} htmlFor="supply-category">
          {LANDING_COPY.supply.categoryLabel}
        </label>
        <div className="relative mt-2">
          <select
            className="h-12 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3.5 pr-10 text-sm font-medium text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            id="supply-category"
            onChange={(event) => {
              const next = event.currentTarget.value;

              onCategoryChange(ROLE_GROUPS.find((group) => group === next) ?? null);
            }}
            value={category ?? ""}
          >
            <option value="">{LANDING_COPY.supply.categoryAny}</option>
            {ROLE_GROUPS.map((option) => (
              <option key={option} value={option}>
                {option}
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
        clearLabel={LANDING_COPY.supply.roleClear}
        id="supply-role"
        label={LANDING_COPY.supply.roleLabel}
        onChange={onGranularRoleChange}
        options={roleOptions}
        placeholder={LANDING_COPY.supply.rolePlaceholder}
        value={granularRole}
      />

      <div>
        <span className={`${dsEyebrow} block`}>{LANDING_COPY.supply.locationLabel}</span>
        <div className="mt-2">
          <Combobox
            ariaLabel={LANDING_COPY.supply.locationLabel}
            clearLabel="Clear location filter"
            clearable
            emptyText={LANDING_COPY.supply.locationEmpty}
            id="supply-location"
            loading={suggestionsLoading}
            onOpenChange={setLocationOpen}
            onSearchChange={setLocationSearch}
            onSelect={(nextValue) => {
              onLocationSelect(nextValue === "" ? null : nextValue);
            }}
            options={locationOptions}
            placeholder={LANDING_COPY.supply.locationPlaceholder}
            searchPlaceholder={LANDING_COPY.supply.locationSearchPlaceholder}
            searchValue={locationSearch}
            value={location ?? ""}
          />
        </div>
      </div>

      <div className="flex h-12 items-center justify-between gap-3 rounded-md border border-input bg-muted/60 px-3.5">
        <label className="text-sm font-medium text-foreground" htmlFor="supply-remote">
          {LANDING_COPY.supply.remoteLabel}
        </label>
        <Switch
          ariaLabel={LANDING_COPY.supply.remoteLabel}
          checked={remote}
          id="supply-remote"
          onCheckedChange={onRemoteChange}
        />
      </div>
    </div>
  );
}
