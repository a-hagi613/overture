import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import {
  ONBOARDING_ROLE_CHIP_LIMIT,
  onboardingRolesForCategory,
  orderOnboardingRoles,
  visibleOnboardingRoles,
} from "../../shared/onboarding-options.ts";
import type { RoleCategoryId } from "../../shared/role-taxonomy.ts";
import { ROLE_CATEGORIES, roleCategoryById } from "../../shared/role-taxonomy.ts";
import { OnboardingTargetChip } from "./onboarding-target-chip.tsx";
import { Button } from "./ui/button.tsx";
import { Combobox } from "./ui/combobox.tsx";
import { dsEyebrow } from "./ui/ds.ts";

const categoryOptions = ROLE_CATEGORIES.map((option) => ({ label: option.name, value: option.id }));

export function OnboardingTargetsRoles({
  category,
  onCategoryChange,
  onToggleRole,
  roleCounts,
  selectedRoles,
}: {
  category: RoleCategoryId;
  onCategoryChange: (next: RoleCategoryId) => void;
  onToggleRole: (role: string) => void;
  roleCounts?: Readonly<Record<string, number>> | undefined;
  selectedRoles: readonly string[];
}) {
  const [expandedCategory, setExpandedCategory] = useState<RoleCategoryId | null>(null);
  const categoryRoles = onboardingRolesForCategory(category);
  const categoryRoleSet = new Set(categoryRoles);
  const otherSelectedRoles = selectedRoles.filter((role) => !categoryRoleSet.has(role));
  const orderedRoles = orderOnboardingRoles(categoryRoles, roleCounts);
  const expanded = expandedCategory === category;
  const { hiddenCount, visible } = visibleOnboardingRoles(orderedRoles, selectedRoles, expanded);

  const showMoreToggle =
    orderedRoles.length > ONBOARDING_ROLE_CHIP_LIMIT && (expanded || hiddenCount > 0);

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
            const matched = roleCategoryById(value);

            if (matched !== undefined) {
              onCategoryChange(matched.id);
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
          {copy.onboarding.rolesInCategory(roleCategoryById(category)?.name ?? category)}
        </h3>
        <fieldset
          aria-labelledby="w-roles"
          className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
        >
          {visible.map((role) => (
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
        {showMoreToggle ? (
          <Button
            ariaExpanded={expanded}
            className="mt-2.5"
            onClick={() => {
              setExpandedCategory(expanded ? null : category);
            }}
            size="sm"
            variant="ghost"
          >
            <span>
              {expanded ? copy.onboarding.fewerRoles : copy.onboarding.moreRoles(hiddenCount)}
            </span>
            {expanded ? (
              <ChevronUp aria-hidden="true" size={14} />
            ) : (
              <ChevronDown aria-hidden="true" size={14} />
            )}
          </Button>
        ) : null}
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
