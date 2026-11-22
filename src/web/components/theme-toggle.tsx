import { NavGlyph } from "./nav-glyph.tsx";
import { useTheme } from "../lib/theme-context.ts";

const COMPACT_BUTTON = "group flex items-center justify-center max-md:h-11 max-md:w-11";

export function ThemeToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { theme, toggleTheme, label } = useTheme();
  const glyph = <NavGlyph name={theme === "dark" ? "sun" : "moon"} />;

  return (
    <button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className={compact ? COMPACT_BUTTON : className}
      onClick={toggleTheme}
      type="button"
    >
      {compact ? <span className={className}>{glyph}</span> : glyph}
    </button>
  );
}
