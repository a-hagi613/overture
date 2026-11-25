import { X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { onboardingLocationChoices } from "../../shared/onboarding-options.ts";
import { Button } from "./ui/button.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { MultiSelectCombobox } from "./ui/multi-select-combobox.tsx";

export function OnboardingTargetsLocations({
  catalogLocations,
  onToggleLocation,
  selectedLocations,
}: {
  catalogLocations: readonly string[];
  onToggleLocation: (location: string) => void;
  selectedLocations: readonly string[];
}) {
  const options = onboardingLocationChoices(catalogLocations, selectedLocations);

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div>
        <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-locations">
          {copy.onboarding.cities}
        </label>
        <MultiSelectCombobox
          emptyText={copy.onboarding.locationsEmpty}
          id="w-locations"
          onToggle={onToggleLocation}
          options={options}
          placeholder={copy.onboarding.locationsPlaceholder}
          searchPlaceholder={copy.onboarding.locationsSearchPlaceholder}
          selected={selectedLocations}
          selectedSummary={copy.onboarding.locationsSelectedCount}
        />
      </div>

      {selectedLocations.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {selectedLocations.map((location) => (
            <Button
              ariaPressed
              className="rounded-full"
              key={location}
              onClick={() => {
                onToggleLocation(location);
              }}
              size="sm"
              variant="primary"
            >
              <span>{location}</span>
              <X aria-hidden="true" size={13} />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
