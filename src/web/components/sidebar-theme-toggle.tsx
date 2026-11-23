import { Moon, Sun } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { useTheme } from "../lib/theme-context.ts";
import { Switch } from "./ui/switch.tsx";

export function SidebarThemeToggle() {
  const { label, theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-md px-3 py-1">
      <span className="flex items-center gap-3 text-base font-medium text-foreground">
        {isDark ? (
          <Sun aria-hidden="true" className="shrink-0 text-signal-text" size={20} />
        ) : (
          <Moon aria-hidden="true" className="shrink-0 text-muted-foreground" size={20} />
        )}
        <span>{isDark ? copy.shell.lightMode : copy.shell.darkMode}</span>
      </span>
      <Switch
        ariaLabel={label}
        checked={isDark}
        onCheckedChange={(checked) => {
          if (checked !== isDark) {
            toggleTheme();
          }
        }}
      />
    </div>
  );
}
