import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { ChevronsUpDown, Search } from "lucide-react";
import { useState } from "react";

import { cn } from "./cn.ts";
import { MultiSelectComboboxItem } from "./multi-select-combobox-item.tsx";

export function MultiSelectCombobox({
  ariaLabel,
  emptyText,
  id,
  onToggle,
  options,
  placeholder,
  searchPlaceholder,
  selected,
  selectedSummary,
}: {
  ariaLabel?: string | undefined;
  emptyText: string;
  id: string;
  onToggle: (value: string) => void;
  options: readonly string[];
  placeholder: string;
  searchPlaceholder: string;
  selected: readonly string[];
  selectedSummary: (count: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const hasSelection = selected.length > 0;
  const triggerLabel = hasSelection ? selectedSummary(selected.length) : placeholder;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setSearch("");
    }
  };

  return (
    <Root onOpenChange={handleOpenChange} open={open}>
      <Trigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className={cn(
            "flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-3.5 text-left text-sm font-medium transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground",
            hasSelection ? "text-foreground" : "text-muted-foreground",
          )}
          id={id}
          type="button"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </Trigger>

      <Portal>
        <Content
          align="start"
          className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl border border-input bg-card text-foreground shadow-lift outline-none"
          sideOffset={6}
        >
          <Command>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                className="h-11 w-full bg-transparent text-sm font-medium text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground"
                onValueChange={setSearch}
                placeholder={searchPlaceholder}
                value={search}
              />
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">
                {emptyText}
              </Command.Empty>
              {options.map((option) => (
                <MultiSelectComboboxItem
                  key={option}
                  onToggle={onToggle}
                  option={option}
                  selected={selected.includes(option)}
                />
              ))}
            </Command.List>
          </Command>
        </Content>
      </Portal>
    </Root>
  );
}
