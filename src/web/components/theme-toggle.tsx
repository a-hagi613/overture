import { NavGlyph } from "./nav-glyph.tsx";
import { useTheme } from "../lib/theme-context.ts";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, label } = useTheme();

  return (
    <button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className={className}
      onClick={toggleTheme}
      type="button"
    >
      <NavGlyph name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
