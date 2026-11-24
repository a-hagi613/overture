import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { demoLoginEmail } from "../../src/shared/demo.ts";
import { authTestIdentity } from "../../test/e2e/auth.fixture.ts";
import { startAppServer } from "../../test/e2e/app-server.ts";
import {
  catalogDatabasePathFor,
  copyTemplateDatabases,
  TEMPLATE_DATABASE,
} from "../../test/e2e/template-databases.ts";

const OUTPUT_DIR = "scripts/demo-video/assets/captures";

type ScreenId = "board" | "home" | "inbox" | "ready" | "review";

interface CaptureSize {
  deviceScaleFactor: number;
  height: number;
  suffix: "desktop" | "mobile";
  width: number;
}

interface Screen {
  heading: RegExp;
  id: ScreenId;
  marker: string | null;
  path: string;
}

const SCREENS: readonly Screen[] = [
  {
    heading: /Good (?:morning|afternoon|evening),/u,
    id: "home",
    marker: null,
    path: "/home",
  },
  {
    heading: /Ready to/iu,
    id: "ready",
    marker: 'section[aria-label="Ready summary"]',
    path: "/ready",
  },
  {
    heading: /Your Review/iu,
    id: "review",
    marker: null,
    path: "/review",
  },
  {
    heading: /Your Applications/iu,
    id: "board",
    marker: "section[data-stage]",
    path: "/applications?view=board",
  },
  {
    heading: /Employer Inbox/iu,
    id: "inbox",
    marker: null,
    path: "/inbox",
  },
];

const SIZES: readonly CaptureSize[] = [
  { deviceScaleFactor: 2, height: 900, suffix: "desktop", width: 1280 },
  { deviceScaleFactor: 3, height: 844, suffix: "mobile", width: 390 },
];

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function buildApp() {
  if (hasFlag("no-build")) {
    return;
  }

  process.stdout.write("building dist before capturing demo frames\n");

  const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" });

  if (build.status !== 0) {
    throw new Error("bun run build failed; fix the build before capturing demo frames");
  }
}

function hideEndingGrant(databasePath: string) {
  const sqlite = new DatabaseSync(databasePath);

  try {
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite.exec("UPDATE grants SET expires_at = NULL WHERE source = 'admin'");
  } finally {
    sqlite.close();
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

async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, {
    timeout: 30_000,
  });

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

  await settle(page);
}

async function signInDemo(browser: Browser, appUrl: string) {
  const context = await browser.newContext({ viewport: { height: 800, width: 1280 } });
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

async function captureSize(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  appUrl: string,
  size: CaptureSize,
) {
  const context = await browser.newContext({
    deviceScaleFactor: size.deviceScaleFactor,
    storageState,
    viewport: { height: size.height, width: size.width },
  });

  await context.addInitScript(() => {
    globalThis.localStorage.setItem("overture.theme", "light");
    globalThis.localStorage.setItem("overture.post-approval-card-dismissed", "1");
  });

  const page = await context.newPage();

  const captureAt = async (index: number) => {
    const screen = SCREENS[index];

    if (screen === undefined) {
      return;
    }

    await page.goto(`${appUrl}${screen.path}`, { waitUntil: "load" });
    await waitForScreen(page, screen);

    const file = join(OUTPUT_DIR, `${screen.id}-${size.suffix}.png`);

    await page.screenshot({ animations: "disabled", caret: "hide", path: file });
    process.stdout.write(`captured ${file}\n`);

    await captureAt(index + 1);
  };

  await captureAt(0);
  await context.close();
}

async function main() {
  buildApp();
  ensureTemplateDatabases();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const scratch = mkdtempSync(join(tmpdir(), "overture-demo-video-"));
  const databasePath = join(scratch, "overture.db");

  copyTemplateDatabases(databasePath);

  const server = await startAppServer(databasePath, {
    DEMO_LOGIN_ENABLED: "true",
    MASTER_KEY_CURRENT: "1",
    MASTER_KEY_V1: authTestIdentity.masterKey,
    OBJECT_STORE_ROOT: join(scratch, "objects"),
  });

  hideEndingGrant(databasePath);

  const browser = await chromium.launch();

  try {
    const storageState = await signInDemo(browser, server.url);

    const captureNext = async (index: number) => {
      const size = SIZES[index];

      if (size === undefined) {
        return;
      }

      await captureSize(browser, storageState, server.url, size);
      await captureNext(index + 1);
    };

    await captureNext(0);
  } finally {
    await browser.close();
    await server.stop();
  }

  process.stdout.write(
    `wrote ${String(SCREENS.length * SIZES.length)} demo frames to ${OUTPUT_DIR}\n`,
  );
}

await main();
