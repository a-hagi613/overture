import { useState } from "react";

import type { RoleCategoryId } from "../../../shared/role-taxonomy.ts";
import type { ComboboxOption } from "../ui/combobox.tsx";

import { ROLE_CATEGORIES, pickableRoles, roleCategoryById } from "../../../shared/role-taxonomy.ts";
import { useLocationSuggestions } from "../../lib/supply-api.ts";
import { Combobox } from "../ui/combobox.tsx";
import { dsEyebrow } from "../ui/ds.ts";
import { Select } from "../ui/select.tsx";
import { Switch } from "../ui/switch.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

/**
 * The landing supply preview's filters: a role-taxonomy category select, a searchable role picker, a debounced
 * global GeoNames location combobox, and a remote-only toggle built on shared UI primitives.
 * @param props Current filter selections and change handlers.
 * @param props.category The chosen category id, or null for every category.
 * @param props.granularRole The chosen role name, or null for any role.
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
  category: RoleCategoryId | null;
  granularRole: string | null;
  location: string | null;
  onCategoryChange: (value: RoleCategoryId | null) => void;
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

  const roleOptions: readonly ComboboxOption[] = pickableRoles(category).map((role) => ({
    label: role.name,
    meta: roleCategoryById(role.categoryId)?.name,
    value: role.name,
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
        <Select
          className="mt-2"
          id="supply-category"
          onChange={(event) => {
            const next = event.currentTarget.value;

            onCategoryChange(roleCategoryById(next)?.id ?? null);
          }}
          selectClassName="h-12 pl-3.5 pr-10"
          value={category ?? ""}
        >
          <option value="">{LANDING_COPY.supply.categoryAny}</option>
          {ROLE_CATEGORIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <span className={`${dsEyebrow} block`}>{LANDING_COPY.supply.roleLabel}</span>
        <div className="mt-2">
          <Combobox
            ariaLabel={LANDING_COPY.supply.roleLabel}
            clearLabel={LANDING_COPY.supply.roleClear}
            clearable
            emptyText={LANDING_COPY.supply.roleEmpty}
            id="supply-role"
            onSelect={(nextValue) => {
              onGranularRoleChange(nextValue === "" ? null : nextValue);
            }}
            options={roleOptions}
            placeholder={LANDING_COPY.supply.rolePlaceholder}
            searchPlaceholder={LANDING_COPY.supply.roleSearchPlaceholder}
            value={granularRole ?? ""}
          />
        </div>
      </div>

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
