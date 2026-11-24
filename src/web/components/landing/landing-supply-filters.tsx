import { ChevronDown } from "lucide-react";

import type { RoleGroup } from "../../../shared/tag-taxonomy.ts";

import { ROLE_GROUPS } from "../../../shared/tag-taxonomy.ts";
import { escoGranularRolesFor } from "../../../shared/esco-roles.ts";
import { Input } from "../ui/input.tsx";
import { RolePicker } from "../ui/role-picker.tsx";
import { Switch } from "../ui/switch.tsx";
import { dsEyebrow } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

/**
 * The landing supply preview's filters: a Level-1 category, a searchable Level-2 role, a place and a remote switch
 * (issue #567, WS-17b). Picking a category narrows the role list to that category's granular roles, and the live
 * count updates for either selection.
 * @param props The current filter values and the callbacks that change them.
 * @param props.category The chosen Level-1 category, or null for every category.
 * @param props.granularRole The chosen Level-2 role, or null for every role.
 * @param props.locationDraft The place text the input shows before it is debounced.
 * @param props.onCategoryChange Called with the chosen category, or null for all categories.
 * @param props.onGranularRoleChange Called with the chosen role, or null for any role.
 * @param props.onLocationChange Called with the place text on every keystroke.
 * @param props.onRadiusChange Called with the chosen radius, or null for an exact city.
 * @param props.onRemoteChange Called with the remote switch's next value.
 * @param props.radius The chosen radius in kilometres, or null for an exact city.
 * @param props.remote Whether the remote-only switch is on.
 * @returns The filter grid inside the supply preview card.
 */
export function LandingSupplyFilters({
  category,
  granularRole,
  locationDraft,
  onCategoryChange,
  onGranularRoleChange,
  onLocationChange,
  onRadiusChange,
  onRemoteChange,
  radius,
  remote,
}: {
  category: RoleGroup | null;
  granularRole: string | null;
  locationDraft: string;
  onCategoryChange: (value: RoleGroup | null) => void;
  onGranularRoleChange: (value: string | null) => void;
  onLocationChange: (value: string) => void;
  onRadiusChange: (value: string | null) => void;
  onRemoteChange: (value: boolean) => void;
  radius: string | null;
  remote: boolean;
}) {
  const roleOptions = escoGranularRolesFor(category).map((option) => ({
    hint: option.category,
    value: option.role,
  }));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={`${dsEyebrow} block`} htmlFor="supply-location">
            {LANDING_COPY.supply.locationLabel}
          </label>
          <Input
            className="mt-2"
            id="supply-location"
            onChange={(event) => {
              onLocationChange(event.currentTarget.value);
            }}
            placeholder={LANDING_COPY.supply.locationPlaceholder}
            type="search"
            value={locationDraft}
          />
        </div>

        <div>
          <label className={`${dsEyebrow} block`} htmlFor="supply-radius">
            {LANDING_COPY.supply.radiusLabel}
          </label>
          <div className="relative mt-2">
            <select
              className="h-12 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3.5 pr-10 text-sm font-medium text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
              id="supply-radius"
              onChange={(event) => {
                const { value } = event.currentTarget;

                onRadiusChange(value === "" ? null : value);
              }}
              value={radius ?? ""}
            >
              <option value="">{LANDING_COPY.supply.radiusExact}</option>
              <option value="25">{LANDING_COPY.supply.radius25}</option>
              <option value="40">{LANDING_COPY.supply.radiusNear}</option>
              <option value="80">{LANDING_COPY.supply.radius80}</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={16}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted px-4 py-2.5">
        <div className="min-w-0">
          <label className="block text-sm font-medium text-foreground" htmlFor="supply-remote">
            {LANDING_COPY.supply.remoteLabel}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">{LANDING_COPY.supply.remoteHint}</p>
        </div>
        <Switch
          ariaLabel={LANDING_COPY.supply.remoteLabel}
          checked={remote}
          id="supply-remote"
          onCheckedChange={onRemoteChange}
        />
      </div>
    </>
  );
}
