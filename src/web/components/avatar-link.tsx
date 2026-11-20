import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { initialsOf } from "../lib/identity.ts";

export function AvatarLink({ name, wide }: { name: string | null; wide: boolean }) {
  const settingsLabel = copy.shell.settings;
  const displayName = name === null || name === "" ? null : name;
  const ariaLabel = displayName === null ? settingsLabel : `${displayName}, ${settingsLabel}`;

  return (
    <Link
      aria-label={ariaLabel}
      className={`flex items-center gap-[11px] rounded-md pt-1.5 ${wide ? "px-1.5" : "justify-center"}`}
      to="/settings"
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-input bg-muted font-serif text-[17px] italic">
        {displayName === null ? "" : initialsOf(displayName)}
      </span>
      {wide ? (
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold leading-[1.25]">
            {displayName}
          </span>
          <span className="block text-xs leading-[1.25] text-muted-foreground">
            {settingsLabel}
          </span>
        </span>
      ) : null}
    </Link>
  );
}
