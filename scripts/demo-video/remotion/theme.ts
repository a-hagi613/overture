/**
 * Ember values for the rendered demo reel. The video is an asset, not the app, so it mirrors DESIGN.md's values here
 * rather than importing the Tailwind theme.
 */
export const EMBER = {
  background: "#F3EEE4",
  border: "rgba(21, 19, 17, 0.14)",
  card: "#FBF8F2",
  foreground: "#151311",
  inkMuted: "#5E5850",
  input: "rgba(21, 19, 17, 0.46)",
  muted: "#E9E3D8",
  scrim: "rgba(21, 19, 17, 0.16)",
  signal: "#D2561F",
  signalSoft: "rgba(210, 86, 31, 0.10)",
  signalText: "#933712",
} as const;

export const FONT = {
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  sans: '"Plus Jakarta Sans", system-ui, sans-serif',
  serif: '"Instrument Serif", Newsreader, Georgia, serif',
} as const;

export const FPS = 30;
export const DESKTOP_WIDTH = 1280;
export const DESKTOP_HEIGHT = 800;
export const MOBILE_WIDTH = 720;
export const MOBILE_HEIGHT = 1280;

export const SURFACE_SHADOW = "0 1px 0 rgba(21,19,17,0.10), 0 28px 56px -26px rgba(21,19,17,0.46)";
