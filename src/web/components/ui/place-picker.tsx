import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import type { PlaceSuggestion } from "../../../shared/places.ts";

import { usePlaceSuggestions } from "../../lib/places-api.ts";
import { cn } from "./cn.ts";
import { PlacePickerOption } from "./place-picker-option.tsx";

const NO_PLACES: readonly string[] = [];
const SEARCHING_LABEL = "Searching places…";

/**
 * A keyboard-accessible place autocomplete. Only a picked suggestion is committed, and every suggestion carries the
 * canonical place id both a saved target and a job use, so free text can never become a pill. The popover's list is a
 * cmdk list, which gives ArrowUp/ArrowDown/Enter/Escape and the combobox/listbox roles for free.
 * @param props The accessible names, the current exclusions and the pick callback.
 * @param props.className Optional wrapper class.
 * @param props.excludeIds Ids already saved, hidden from the list.
 * @param props.id The trigger's id, which a label points at.
 * @param props.noResults Shown when nothing matches.
 * @param props.onPick Called with the chosen suggestion.
 * @param props.placeholder The search input's placeholder, also its accessible name.
 * @param props.triggerLabel The trigger button's text.
 * @returns The picker.
 */
export function PlacePicker({
  className,
  excludeIds = NO_PLACES,
  id,
  noResults,
  onPick,
  placeholder,
  triggerLabel,
}: {
  className?: string;
  excludeIds?: readonly string[];
  id: string;
  noResults: string;
  onPick: (place: PlaceSuggestion) => void;
  placeholder: string;
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { loading, suggestions } = usePlaceSuggestions(query, open);
  const visible = suggestions.filter((place) => !excludeIds.includes(place.id));

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <Root
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
        } else {
          close();
        }
      }}
      open={open}
    >
      <Trigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground md:min-h-9"
          id={id}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          <span>{triggerLabel}</span>
        </button>
      </Trigger>

      <Portal>
        <Content
          align="start"
          className={cn(
            "z-50 w-72 overflow-hidden rounded-xl border border-input bg-card text-foreground shadow-lift outline-none sm:w-80",
            className,
          )}
          sideOffset={6}
        >
          <Command label={placeholder} shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                className="h-11 w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
                onValueChange={setQuery}
                placeholder={placeholder}
                value={query}
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-1.5">
              {loading ? (
                <p aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground">
                  {SEARCHING_LABEL}
                </p>
              ) : null}
              <Command.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">
                {noResults}
              </Command.Empty>
              {visible.map((place) => (
                <PlacePickerOption
                  key={`${place.id}:${place.meta}`}
                  onPick={(picked) => {
                    onPick(picked);
                    close();
                  }}
                  place={place}
                />
              ))}
            </Command.List>
          </Command>
        </Content>
      </Portal>
    </Root>
  );
}
