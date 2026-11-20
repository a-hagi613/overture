import { createContext, useContext } from "react";

import { copy } from "../../shared/copy.ts";

export type Theme = "light" | "dark";

const themeStorageKey = "overture.theme";

const keepTheme = () => undefined;

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  label: string;
}

const fallbackThemeState: ThemeState = {
  theme: "light",
  toggleTheme: keepTheme,
  label: copy.shell.themeToDark,
};

const ThemeContext = createContext<ThemeState>(fallbackThemeState);

export function useTheme() {
  return useContext(ThemeContext);
}

export function themeStorageKeyOf() {
  return themeStorageKey;
}

export { ThemeContext, fallbackThemeState };

export type { ThemeState };
