import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { useState } from "react";

import type { ComboboxOption } from "./combobox-option.tsx";

import { cn } from "./cn.ts";
import { ComboboxOptionItem } from "./combobox-option.tsx";

export type { ComboboxOption } from "./combobox-option.tsx";

export function Combobox({
  ariaLabel,
  clearLabel = "Clear selection",
  clearable = false,
  emptyText = "No matches found.",
  id,
  loading = false,
  loadingText = "Searching…",
  onOpenChange,
  onSearchChange,
  onSelect,
  options,
  placeholder,
  searchPlaceholder,
  searchValue,
  value,
}: {
  ariaLabel?: string;
  clearLabel?: string;
  clearable?: boolean;
  emptyText?: string;
  id: string;
  loading?: boolean;
  loadingText?: string;
  onOpenChange?: (open: boolean) => void;
  onSearchChange?: (search: string) => void;
  onSelect: (value: string) => void;
  options: readonly ComboboxOption[];
  placeholder: string;
  searchPlaceholder: string;
  searchValue?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState("");

  const activeSearch = searchValue ?? internalSearch;
  const selected = options.find((option) => option.value === value);
  const displayLabel = selected?.label ?? (value === "" ? placeholder : value);
  const hasSelection = value !== "";

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);

    if (!nextOpen) {
      setInternalSearch("");
      onSearchChange?.("");
    }
  };

  const handleSearch = (nextSearch: string) => {
    if (searchValue === undefined) {
      setInternalSearch(nextSearch);
    }

    onSearchChange?.(nextSearch);
  };

  return (
    <Root onOpenChange={handleOpenChange} open={open}>
      <div className="relative flex w-full items-center">
        <Trigger asChild>
          <button
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              "flex h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card pl-3.5 text-left text-sm font-medium transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground",
              clearable && hasSelection ? "pr-16" : "pr-3.5",
              hasSelection ? "text-foreground" : "text-muted-foreground",
            )}
            id={id}
            type="button"
          >
            {ariaLabel === undefined ? null : <span className="sr-only">{`${ariaLabel}: `}</span>}
            <span className="truncate">{displayLabel}</span>
            <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </Trigger>

        {clearable && hasSelection ? (
          <button
            aria-label={clearLabel}
            className="absolute right-8 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            onClick={() => {
              onSelect("");
              handleSearch("");
            }}
            type="button"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <Portal>
        <Content
          align="start"
          className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl border border-input bg-card text-foreground shadow-lift outline-none"
          sideOffset={6}
        >
          <Command shouldFilter={onSearchChange === undefined}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                className="h-11 w-full bg-transparent text-sm font-medium text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground"
                onValueChange={handleSearch}
                placeholder={searchPlaceholder}
                value={activeSearch}
              />
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1.5">
              {loading && options.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {loadingText}
                </div>
              ) : null}
              <Command.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">
                {loading ? loadingText : emptyText}
              </Command.Empty>
              {options.map((option) => (
                <ComboboxOptionItem
                  isSelected={option.value === value}
                  key={`${option.value}-${option.meta ?? ""}`}
                  onSelectValue={(nextValue) => {
                    onSelect(nextValue);
                    handleOpenChange(false);
                  }}
                  option={option}
                />
              ))}
            </Command.List>
          </Command>
        </Content>
      </Portal>
    </Root>
  );
}
