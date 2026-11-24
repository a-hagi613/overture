import { ChevronDown } from "lucide-react";

import type { RoleGroup } from "../../../shared/tag-taxonomy.ts";

import { ROLE_GROUPS } from "../../../shared/tag-taxonomy.ts";
import { Input } from "../ui/input.tsx";
import { Switch } from "../ui/switch.tsx";
import { dsEyebrow } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

/**
 * The landing supply preview's three filters: a role group, a free-text place and a remote switch.
 * @param props The current filter values and the callbacks that change them.
 * @param props.locationDraft The place text the input shows before it is debounced.
 * @param props.onLocationChange Called with the place text on every keystroke.
 * @param props.onRadiusChange Called with the chosen radius, or null for an exact city.
 * @param props.onRemoteChange Called with the remote switch's next value.
 * @param props.onRoleChange Called with the chosen role group, or an empty string for all roles.
 * @param props.radius The chosen radius in kilometres, or null for an exact city.
 * @param props.remote Whether the remote-only switch is on.
 * @param props.role The chosen role group, or null for all roles.
 * @returns The filter row inside the supply preview card.
 */
export function LandingSupplyFilters({
  locationDraft,
  onLocationChange,
  onRadiusChange,
  onRemoteChange,
  onRoleChange,
  radius,
  remote,
  role,
}: {
  locationDraft: string;
  onLocationChange: (value: string) => void;
  onRadiusChange: (value: string | null) => void;
  onRemoteChange: (value: boolean) => void;
  onRoleChange: (value: string) => void;
  radius: string | null;
  remote: boolean;
  role: RoleGroup | null;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={`${dsEyebrow} block`} htmlFor="supply-role">
            {LANDING_COPY.supply.roleLabel}
          </label>
          <div className="relative mt-2">
            <select
              className="h-12 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3.5 pr-10 text-sm font-medium text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
              id="supply-role"
              onChange={(event) => {
                onRoleChange(event.currentTarget.value);
              }}
              value={role ?? ""}
            >
              <option value="">{LANDING_COPY.supply.roleAny}</option>
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
      </div>

      <div className="mt-4">
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
