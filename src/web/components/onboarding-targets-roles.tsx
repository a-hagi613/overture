import { X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { onboardingRolesForCategory } from "../../shared/onboarding-options.ts";
import type { RoleGroup } from "../../shared/tag-taxonomy.ts";
import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";
import { OnboardingTargetChip } from "./onboarding-target-chip.tsx";
import { Button } from "./ui/button.tsx";
import { Combobox } from "./ui/combobox.tsx";
import { dsEyebrow } from "./ui/ds.ts";

const categoryOptions = ROLE_GROUPS.map((group) => ({ label: group, value: group }));

export function OnboardingTargetsRoles({
  category,
  onCategoryChange,
  onToggleRole,
  selectedRoles,
}: {
  category: RoleGroup;
  onCategoryChange: (next: RoleGroup) => void;
  onToggleRole: (role: string) => void;
  selectedRoles: readonly string[];
}) {
  const categoryRoles = onboardingRolesForCategory(category);
  const categoryRoleSet = new Set(categoryRoles);
  const otherSelectedRoles = selectedRoles.filter((role) => !categoryRoleSet.has(role));

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <label className={dsEyebrow} htmlFor="w-category">
            {copy.onboarding.categoryLabel}
          </label>
          <span className="text-xs text-muted-foreground">{copy.onboarding.atLeastOne}</span>
        </div>
        <Combobox
          ariaLabel={copy.onboarding.categoryLabel}
          emptyText={copy.onboarding.categoryEmpty}
          id="w-category"
          onSelect={(value) => {
            const matched = ROLE_GROUPS.find((group) => group === value);

            if (matched !== undefined) {
              onCategoryChange(matched);
            }
          }}
          options={categoryOptions}
          placeholder={copy.onboarding.categoryPlaceholder}
          searchPlaceholder={copy.onboarding.categorySearchPlaceholder}
          value={category}
        />
      </div>

      <div>
        <h3 className={`${dsEyebrow} mb-2.5`} id="w-roles">
          {copy.onboarding.rolesInCategory(category)}
        </h3>
        <fieldset
          aria-labelledby="w-roles"
          className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
        >
          {categoryRoles.map((role) => (
            <OnboardingTargetChip
              key={role}
              on={selectedRoles.includes(role)}
              onClick={() => {
                onToggleRole(role);
              }}
            >
              {role}
            </OnboardingTargetChip>
          ))}
        </fieldset>
      </div>

      {otherSelectedRoles.length === 0 ? null : (
        <div>
          <p className={`${dsEyebrow} mb-2`}>
            {copy.onboarding.otherSelectedRolesLabel(otherSelectedRoles.length)}
          </p>
          <div className="flex flex-wrap gap-2">
            {otherSelectedRoles.map((role) => (
              <Button
                ariaPressed
                className="rounded-full"
                key={role}
                onClick={() => {
                  onToggleRole(role);
                }}
                size="sm"
                variant="primary"
              >
                <span>{role}</span>
                <X aria-hidden="true" size={13} />
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
