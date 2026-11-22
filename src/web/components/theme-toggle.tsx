import { NavGlyph } from "./nav-glyph.tsx";
import { useTheme } from "../lib/theme-context.ts";

export function ThemeToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { theme, toggleTheme, label } = useTheme();
  const glyph = <NavGlyph name={theme === "dark" ? "sun" : "moon"} />;

  if (!compact) {
    return (
      <button
        aria-label={label}
        aria-pressed={theme === "dark"}
        className={className}
        onClick={toggleTheme}
        type="button"
      >
        {glyph}
      </button>
    );
  }

  return (
    <button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="group flex items-center justify-center max-md:h-11 max-md:w-11"
      onClick={toggleTheme}
      type="button"
    >
      <span className={className}>{glyph}</span>
    </button>
  );
}
