import { X } from "lucide-react";

import type { PlaceSuggestion } from "../../shared/places.ts";

import { copy } from "../../shared/copy.ts";
import { placeFallbackLabel } from "../../shared/places.ts";
import { Button } from "./ui/button.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { PlacePicker } from "./ui/place-picker.tsx";

export function OnboardingTargetsLocations({
  onPickLocation,
  onRemoveLocation,
  places,
  selectedLocations,
}: {
  onPickLocation: (place: PlaceSuggestion) => void;
  onRemoveLocation: (id: string) => void;
  places: readonly PlaceSuggestion[];
  selectedLocations: readonly string[];
}) {
  const labelOf = (id: string) =>
    places.find((place) => place.id === id)?.label ?? placeFallbackLabel(id);

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div>
        <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-locations">
          {copy.onboarding.cities}
        </label>
        <PlacePicker
          excludeIds={selectedLocations}
          id="w-locations"
          noResults={copy.onboarding.locationsEmpty}
          onPick={onPickLocation}
          placeholder={copy.onboarding.locationsSearchPlaceholder}
          triggerLabel={copy.onboarding.addLocation}
        />
      </div>

      {selectedLocations.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {selectedLocations.map((id) => (
            <li key={id}>
              <Button
                ariaLabel={copy.profile.targets.removeLocation(labelOf(id))}
                className="rounded-full"
                onClick={() => {
                  onRemoveLocation(id);
                }}
                size="sm"
                variant="primary"
              >
                <span>{labelOf(id)}</span>
                <X aria-hidden="true" size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
