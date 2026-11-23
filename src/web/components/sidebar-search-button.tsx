import { Search } from "lucide-react";

import { copy } from "../../shared/copy.ts";

export function SidebarSearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md border border-input bg-card px-3 text-left text-sm font-medium text-muted-foreground shadow-sh transition hover:border-foreground hover:text-foreground"
      onClick={onOpen}
      type="button"
    >
      <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{copy.shell.searchCompact}</span>
      <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1">
        <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-xs font-medium leading-none text-muted-foreground">
          {copy.shell.searchShortcutMod}
        </kbd>
        <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-xs font-medium leading-none text-muted-foreground">
          {copy.shell.searchShortcutKey}
        </kbd>
      </span>
    </button>
  );
}
