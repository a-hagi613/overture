import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

const routeSource = readFileSync(join(process.cwd(), "src/web/route-table.tsx"), "utf8");

const routerPaths = [...routeSource.matchAll(/path: "(?<path>[^"]+)"/gu)].map(
  (match) => match.groups?.path ?? "",
);

export type Storage = "app" | "admin" | "anonymous";

export interface Target {
  path: string;
  url: string;
  storage: Storage;
}

function storageFor(path: string) {
  if (path.startsWith("/admin")) {
    return "admin" as const;
  }

  if (
    path === "/" ||
    path === "/signin" ||
    path === "/signup" ||
    path === "/terms" ||
    path === "/privacy" ||
    path === "/consent" ||
    path === "/forgot-password" ||
    path === "/reset-password"
  ) {
    return "anonymous" as const;
  }

  return "app" as const;
}

function urlFor(path: string) {
  if (path === "*") {
    return "/__missing__";
  }

  return path.replace(":id", "unknown-user");
}

export const targets: Target[] = routerPaths.map((path) => ({
  path,
  storage: storageFor(path),
  url: urlFor(path),
}));

const redirects = new Map(
  [
    ...routeSource.matchAll(
      /path: "(?<from>[^"]+)", element: <Navigate replace to="(?<to>[^"]+)" \/>/gu,
    ),
  ].map((match) => [match.groups?.from ?? "", match.groups?.to ?? ""]),
);

/**
 * The path a route settles on: its own path, or the target of a `<Navigate>` redirect.
 *
 * @param path - A route path as listed in the route table.
 * @returns The path the browser ends on after the route renders.
 */
export function landingPath(path: string) {
  return redirects.get(path) ?? path;
}

export async function navigate(page: Page, path: string, landing = path) {
  await page.evaluate(async (next) => {
    globalThis.history.pushState({}, "", next);
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }, path);
  await page.waitForFunction((next) => globalThis.location.pathname === next, landing);
}

export async function openContext(
  browser: Browser,
  storage: Storage,
  width: number,
  theme: string,
  storageStates: {
    admin: Awaited<ReturnType<BrowserContext["storageState"]>>;
    app: Awaited<ReturnType<BrowserContext["storageState"]>>;
  },
) {
  const viewport = { height: 900, width };

  const context =
    storage === "anonymous"
      ? await browser.newContext({ viewport })
      : await browser.newContext({
          storageState: storage === "app" ? storageStates.app : storageStates.admin,
          viewport,
        });

  if (theme === "dark") {
    await context.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  return context;
}
