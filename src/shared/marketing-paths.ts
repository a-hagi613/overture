/**
 * The public marketing pages the build prerenders. `scripts/prerender.tsx` inlines the stylesheet and
 * copies the shared theme boot script into `MARKETING_BUILD_ROOT` with one HTML file per page, and
 * `workers/marketing` attaches a Worker route for each path here, so a new marketing page cannot ship
 * without a route.
 */

export const PRERENDERED_MARKETING_PATHS: readonly string[] = ["/"];

export const MARKETING_BUILD_ROOT = "dist-marketing";
