/**
 * The public marketing pages the build prerenders. `scripts/prerender.tsx` inlines the stylesheet into
 * one HTML file per page in `MARKETING_BUILD_ROOT`, and `workers/marketing` attaches a Worker route for
 * each path here, so a new marketing page cannot ship without a route. The page carries the same inline
 * theme boot as the app shell, so it needs no origin request and stays styled and themed with Fly down.
 */

export const PRERENDERED_MARKETING_PATHS: readonly string[] = ["/"];

export const MARKETING_BUILD_ROOT = "dist-marketing";
