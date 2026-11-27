import { X } from "lucide-react";

import type { PlaceSuggestion } from "../../shared/places.ts";

import { Button } from "./ui/button.tsx";
import { PlacePicker } from "./ui/place-picker.tsx";

/**
 * One saved location the resolver could not pin to a place, with a picker to replace it and a dismiss button. It is a
 * row of the Profile target unresolved list.
 * @param props The raw value, the copy and the two actions.
 * @param props.dismissLabel The dismiss button's accessible name.
 * @param props.id The picker's id, unique per row.
 * @param props.noResults The picker's empty text.
 * @param props.onDismiss Called when the person dismisses the value.
 * @param props.onPick Called with the exact place the person picked.
 * @param props.placeholder The picker's search placeholder.
 * @param props.raw The saved text.
 * @param props.triggerLabel The picker trigger's text.
 * @returns The list row.
 */
export function UnresolvedPlaceRow({
  dismissLabel,
  id,
  noResults,
  onDismiss,
  onPick,
  placeholder,
  raw,
  triggerLabel,
}: {
  dismissLabel: string;
  id: string;
  noResults: string;
  onDismiss: () => void;
  onPick: (place: PlaceSuggestion) => void;
  placeholder: string;
  raw: string;
  triggerLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{raw}</span>
      <span className="flex items-center gap-2">
        <PlacePicker
          id={id}
          noResults={noResults}
          onPick={onPick}
          placeholder={placeholder}
          triggerLabel={triggerLabel}
        />
        <Button ariaLabel={dismissLabel} onClick={onDismiss} size="sm" variant="ghost">
          <X aria-hidden="true" size={14} />
        </Button>
      </span>
    </li>
  );
}
