import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { authTestIdentity } from "../test/e2e/auth.fixture.ts";
import { startAppServer } from "../test/e2e/app-server.ts";
import {
  catalogDatabasePathFor,
  copyTemplateDatabases,
  TEMPLATE_DATABASE,
} from "../test/e2e/template-databases.ts";
import { demoLoginEmail } from "../src/shared/demo.ts";

const DEFAULT_OUTPUT = "public/previews";
const DESKTOP_VIEWPORT = { height: 860, width: 1280 };
const MOBILE_VIEWPORT = { height: 844, width: 390 };
const THEMES: readonly Theme[] = ["light", "dark"];

type ScreenId = "board" | "calendar" | "home" | "inbox" | "profile";

type Theme = "dark" | "light";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface Viewport {
  height: number;
  width: number;
}

interface Screen {
  id: ScreenId;
  desktopPath: string;
  mobilePath: string;
  heading: RegExp;
  marker: string | null;
}

const screens: readonly Screen[] = [
  {
    id: "home",
    desktopPath: "/home",
    mobilePath: "/home",
    heading: /Good (?:morning|afternoon|evening),/u,
    marker: null,
  },
  {
    id: "board",
    desktopPath: "/applications",
    mobilePath: "/applications?view=board",
    heading: /Your Applications/u,
    marker: "section[data-stage]",
  },
  {
    id: "inbox",
    desktopPath: "/inbox",
    mobilePath: "/inbox",
    heading: /Employer Inbox/u,
    marker: null,
  },
  {
    id: "calendar",
    desktopPath: "/applications?view=calendar",
    mobilePath: "/applications?view=calendar",
    heading: /Job Calendar/u,
    marker: 'aside[aria-label="Day panel"]',
  },
  {
    id: "profile",
    desktopPath: "/profile/resume",
    mobilePath: "/profile/resume",
    heading: /Resume & Cover Letter/u,
    marker: "text=PDF verified",
  },
];

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function buildApp() {
  if (hasFlag("no-build")) {
    return;
  }

  process.stdout.write("building dist before capture\n");

  const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" });

  if (build.status !== 0) {
    throw new Error("bun run build failed; fix the build before capturing previews");
  }
}

function ensureTemplateDatabases() {
  if (existsSync(TEMPLATE_DATABASE) && existsSync(catalogDatabasePathFor(TEMPLATE_DATABASE))) {
    return;
  }

  mkdirSync("test/e2e/.tmp", { recursive: true });

  const template = spawnSync("bun", ["run", "scripts/create-template-db.ts", TEMPLATE_DATABASE], {
    stdio: "inherit",
  });

  if (template.status !== 0) {
    throw new Error("template database creation failed");
  }
}

async function waitForImagesToDecode(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;

    await Promise.all(
      [...document.images].map(async (image) => image.decode().catch(() => undefined)),
    );

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

async function waitForScreen(page: Page, screen: Screen) {
  await page
    .getByRole("heading", { level: 1, name: screen.heading })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  if (screen.marker !== null) {
    await page.locator(screen.marker).first().waitFor({ state: "visible", timeout: 30_000 });
  }

  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, {
    timeout: 30_000,
  });
  await waitForImagesToDecode(page);
}

async function signInDemo(browser: Browser, appUrl: string) {
  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
  const page = await context.newPage();

  await page.goto(`${appUrl}/signin`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(demoLoginEmail);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page
    .getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u })
    .waitFor({ state: "visible", timeout: 30_000 });

  const storageState = await context.storageState();

  await context.close();

  return storageState;
}

async function captureScreen(
  page: Page,
  appUrl: string,
  screen: Screen,
  path: string,
  file: string,
) {
  await page.goto(`${appUrl}${path}`, { waitUntil: "load" });
  await waitForScreen(page, screen);
  await page.screenshot({ animations: "disabled", caret: "hide", path: file });

  process.stdout.write(`captured ${file}\n`);
}

async function captureViewport(
  browser: Browser,
  storageState: StorageState,
  appUrl: string,
  theme: Theme,
  viewport: Viewport,
  outputDir: string,
  mobile: boolean,
) {
  const context = await browser.newContext({ storageState, viewport });

  await context.addInitScript((storedTheme) => {
    globalThis.localStorage.setItem("overture.theme", storedTheme);
    globalThis.localStorage.setItem("overture.post-approval-card-dismissed", "1");
  }, theme);

  const page = await context.newPage();

  const captureAt = async (index: number) => {
    const screen = screens[index];

    if (screen === undefined) {
      return;
    }

    const path = mobile ? screen.mobilePath : screen.desktopPath;
    const suffix = mobile ? "-mobile" : "";
    const file = join(outputDir, `${screen.id}${suffix}-${theme}.png`);

    await captureScreen(page, appUrl, screen, path, file);
    await captureAt(index + 1);
  };

  await captureAt(0);
  await context.close();
}

async function main() {
  const outputDir = argument("output") ?? DEFAULT_OUTPUT;

  buildApp();
  ensureTemplateDatabases();
  mkdirSync(outputDir, { recursive: true });

  const scratch = mkdtempSync(join(tmpdir(), "overture-previews-"));
  const databasePath = join(scratch, "overture.db");

  copyTemplateDatabases(databasePath);

  const server = await startAppServer(databasePath, {
    DEMO_LOGIN_ENABLED: "true",
    MASTER_KEY_CURRENT: "1",
    MASTER_KEY_V1: authTestIdentity.masterKey,
    OBJECT_STORE_ROOT: join(scratch, "objects"),
  });

  const browser = await chromium.launch();

  try {
    const storageState = await signInDemo(browser, server.url);

    const captureTheme = async (index: number) => {
      const theme = THEMES[index];

      if (theme === undefined) {
        return;
      }

      await captureViewport(
        browser,
        storageState,
        server.url,
        theme,
        DESKTOP_VIEWPORT,
        outputDir,
        false,
      );
      await captureViewport(
        browser,
        storageState,
        server.url,
        theme,
        MOBILE_VIEWPORT,
        outputDir,
        true,
      );
      await captureTheme(index + 1);
    };

    await captureTheme(0);
  } finally {
    await browser.close();
    await server.stop();
  }

  process.stdout.write(
    `wrote ${String(screens.length * THEMES.length * 2)} previews to ${outputDir}\n`,
  );
}

await main();
