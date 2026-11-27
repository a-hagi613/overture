import { Command } from "cmdk";

import type { PlaceSuggestion } from "../../../shared/places.ts";

import { cn } from "./cn.ts";
import { dsEyebrow } from "./ds.ts";

const KIND_LABELS = {
  city: "City",
  country: "Country",
  metro: "Metro",
  region: "Region",
  remote_continent: "Remote",
  remote_country: "Remote",
  remote_worldwide: "Remote",
} as const satisfies Record<PlaceSuggestion["kind"], string>;

/**
 * One suggestion row in the place picker: label, region/country line and the kind as a quiet eyebrow.
 * @param props The suggestion and the pick callback.
 * @param props.onPick Called with the suggestion when the row is selected.
 * @param props.place The suggestion to render.
 * @returns A cmdk option.
 */
export function PlacePickerOption({
  onPick,
  place,
}: {
  onPick: (place: PlaceSuggestion) => void;
  place: PlaceSuggestion;
}) {
  return (
    <Command.Item
      className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 outline-none transition data-[selected=true]:bg-muted"
      onSelect={() => {
        onPick(place);
      }}
      value={`${place.label} ${place.meta}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{place.label}</span>
        {place.meta === "" ? null : (
          <span className="truncate text-xs text-muted-foreground">{place.meta}</span>
        )}
      </span>
      <span className={cn(dsEyebrow, "shrink-0")}>{KIND_LABELS[place.kind]}</span>
    </Command.Item>
  );
}
