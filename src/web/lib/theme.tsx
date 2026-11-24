import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import { copy } from "../../shared/copy.ts";
import { ThemeContext, fallbackThemeState, themeStorageKeyOf } from "./theme-context.ts";
import type { Theme, ThemeState } from "./theme-context.ts";

const SWITCH_CLASS = "theme-switching";
const SWITCH_MS = 180;

interface ThemeSwitch {
  timer: ReturnType<typeof globalThis.setTimeout> | null;
}

const themeSwitch: ThemeSwitch = { timer: null };

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

  useEffect(
    () => () => {
      if (themeSwitch.timer !== null) {
        globalThis.clearTimeout(themeSwitch.timer);
      }

      globalThis.document.documentElement.classList.remove(SWITCH_CLASS);
    },
    [],
  );

  const toggleTheme = useCallback(() => {
    const root = globalThis.document.documentElement;

    root.classList.add(SWITCH_CLASS);

    if (themeSwitch.timer !== null) {
      globalThis.clearTimeout(themeSwitch.timer);
    }

    themeSwitch.timer = globalThis.setTimeout(() => {
      root.classList.remove(SWITCH_CLASS);
      themeSwitch.timer = null;
    }, SWITCH_MS);

    setTheme((current: Theme) => (current === "dark" ? "light" : "dark"));
  }, []);

  const state: ThemeState = useMemo(
    () => ({
      label: theme === "dark" ? copy.shell.themeToLight : copy.shell.themeToDark,
      theme,
      toggleTheme,
    }),
    [theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={state === fallbackThemeState ? fallbackThemeState : state}>
      {children}
    </ThemeContext.Provider>
  );
}
