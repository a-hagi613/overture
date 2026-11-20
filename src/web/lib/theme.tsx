import { useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import { copy } from "../../shared/copy.ts";
import { ThemeContext, fallbackThemeState, themeStorageKeyOf } from "./theme-context.ts";
import type { Theme, ThemeState } from "./theme-context.ts";

function readInitialTheme() {
  const saved = globalThis.localStorage.getItem(themeStorageKeyOf());

  if (saved === "light" || saved === "dark") {
    return saved;
  }

  return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useLayoutEffect(() => {
    globalThis.document.documentElement.classList.toggle("dark", theme === "dark");
    globalThis.localStorage.setItem(themeStorageKeyOf(), theme);
  }, [theme]);

  const state: ThemeState = useMemo(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((current: Theme) => (current === "dark" ? "light" : "dark"));
      },
      label: theme === "dark" ? copy.shell.themeToLight : copy.shell.themeToDark,
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={state === fallbackThemeState ? fallbackThemeState : state}>
      {children}
    </ThemeContext.Provider>
  );
}
