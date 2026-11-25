import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import { z } from "zod";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { DEMO_COMPANIES } from "../../src/server/demo/sample-data.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";
import { demoLoginEmail } from "../../src/shared/demo.ts";
import { startAppServer } from "../../test/e2e/app-server.ts";
import { authTestIdentity } from "../../test/e2e/auth.fixture.ts";
import {
  catalogDatabasePathFor,
  copyTemplateDatabases,
  TEMPLATE_DATABASE,
} from "../../test/e2e/template-databases.ts";

const OUTPUT_DIR = "scripts/demo-video/assets/captures";
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_WEEKLY_COUNTS = [2, 3, 4, 5, 7, 9, 12, 14, 17, 20, 23, 27, 32] as const;

const POLISH_ROLE_TITLES = [
  "Senior Backend Engineer",
  "Staff Platform Engineer",
  "Principal Systems Engineer",
  "Software Engineer, Distributed Systems",
  "Senior Infrastructure Engineer",
  "Lead Cloud Engineer",
  "Backend Engineer, Payments",
  "Staff Software Engineer",
] as const;

type ScreenId = "calendar" | "home" | "inbox" | "ready" | "resume" | "review" | "tracker";

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
    heading: /Approval\s*Queue/iu,
    id: "ready",
    marker: null,
    path: "/ready",
  },
  {
    heading: /Review\s*Queue/iu,
    id: "review",
    marker: null,
    path: "/review",
  },
  {
    heading: /Application\s*Tracker/iu,
    id: "tracker",
    marker: "section[data-stage], [data-card]",
    path: "/tracker",
  },
  {
    heading: /Resume & Cover Letter/iu,
    id: "resume",
    marker: "#profile-resume",
    path: "/profile/resume",
  },
  {
    heading: /Inbox/iu,
    id: "inbox",
    marker: null,
    path: "/inbox",
  },
  {
    heading: /Calendar/iu,
    id: "calendar",
    marker: null,
    path: "/calendar",
  },
];

const SIZES: readonly CaptureSize[] = [
  { deviceScaleFactor: 2, height: 800, suffix: "desktop", width: 1280 },
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

const userRowSchema = z.object({ id: z.string() });
const countRowSchema = z.object({ total: z.number() });

function polishDemoVideoDatabase(databasePath: string) {
  const sqlite = new DatabaseSync(databasePath);

  try {
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite.exec("UPDATE grants SET expires_at = NULL WHERE source = 'admin'");
    sqlite.exec("DELETE FROM applications WHERE status IN ('failed', 'skipped')");

    const demoUser = userRowSchema
      .optional()
      .parse(sqlite.prepare("SELECT id FROM users WHERE email = ?").get(demoLoginEmail));

    if (demoUser === undefined) {
      return;
    }

    const scoreUpdates: readonly [string, number][] = [
      ["demo-posting-41", 96],
      ["demo-posting-01", 94],
      ["demo-posting-02", 91],
      ["demo-posting-03", 95],
    ];

    const updateMatch = sqlite.prepare(
      "UPDATE matches SET score = ? WHERE user_id = ? AND posting_id = ?",
    );

    const updateQueueScore = sqlite.prepare(
      "UPDATE applications SET score_at_queue = ? WHERE user_id = ? AND posting_id = ?",
    );

    for (const [postingId, score] of scoreUpdates) {
      updateMatch.run(score, demoUser.id, postingId);
      updateQueueScore.run(score, demoUser.id, postingId);
    }

    const now = createClock().now();

    const countStmt = sqlite.prepare(
      "SELECT count(*) AS total FROM applications WHERE user_id = ? AND sent_at IS NOT NULL AND sent_at >= ? AND sent_at < ?",
    );

    const insertApp = sqlite.prepare(
      `INSERT OR IGNORE INTO applications (
        id, user_id, posting_id, company_id, ats, company_name, company_name_norm,
        company_domain, posting_title, posting_url, apply_url, location_raw,
        salary_currency, salary_min_minor, salary_max_minor, salary_period,
        origin, status, status_reason, stage, stage_locked, board_position,
        score_at_queue, ready_at, approved_at, sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Remote — Canada', 'CAD', 16500000, 21000000, 'year', 'auto', 'sent', NULL, 'applied', 0, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let sequence = 1;

    for (const [bucketIndex, targetCount] of TARGET_WEEKLY_COUNTS.entries()) {
      const bucketEndDaysAgo = (12 - bucketIndex) * 7;
      const bucketStart = now - (bucketEndDaysAgo + 6.5) * DAY_MS;
      const bucketEnd = bucketIndex === 12 ? now + 1 : now - (bucketEndDaysAgo - 0.5) * DAY_MS;

      const row = countRowSchema
        .optional()
        .parse(countStmt.get(demoUser.id, bucketStart, bucketEnd));

      const needed = Math.max(0, targetCount - (row?.total ?? 0));

      for (let item = 0; item < needed; item += 1) {
        const company = DEMO_COMPANIES[(sequence - 1) % DEMO_COMPANIES.length];
        const title = POLISH_ROLE_TITLES[(sequence - 1) % POLISH_ROLE_TITLES.length];

        if (company === undefined || title === undefined) {
          continue;
        }

        const fraction = (item + 0.5) / Math.max(1, needed);
        const nonTodayWindowEnd = now - 1.15 * DAY_MS;

        let candidateSentAt: number;

        if (bucketIndex === 12 && item < 3) {
          candidateSentAt = now - (item + 1) * 20 * 60_000;
        } else if (bucketIndex === 12) {
          candidateSentAt =
            bucketStart + fraction * Math.max(60_000, nonTodayWindowEnd - bucketStart);
        } else {
          candidateSentAt = bucketStart + fraction * (bucketEnd - bucketStart - 60_000);
        }

        const sentAt = Math.min(now - 60_000, Math.round(candidateSentAt));
        const createdAt = sentAt - DAY_MS;
        const companyIndex = DEMO_COMPANIES.indexOf(company);
        const appId = `demo-vid-app-${String(sequence).padStart(3, "0")}`;
        const postingId = `demo-vid-posting-${String(sequence).padStart(3, "0")}`;
        const url = `https://jobs.example.com/${company.boardToken}/vid-${String(sequence)}`;
        const score = 86 + ((sequence * 3) % 11);

        insertApp.run(
          appId,
          demoUser.id,
          postingId,
          `demo-company-${String(companyIndex).padStart(2, "0")}`,
          company.ats,
          company.name,
          company.name.toLowerCase(),
          company.domain,
          title,
          url,
          100 + sequence,
          score,
          createdAt + 3_600_000,
          sentAt - 3_600_000,
          sentAt,
          createdAt,
          sentAt,
        );

        sequence += 1;
      }
    }
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

  await page.waitForTimeout(450);
}

async function waitForScreen(page: Page, screen: Screen) {
  await page
    .getByRole("heading", { level: 1, name: screen.heading })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  if (screen.marker !== null) {
    await page.locator(screen.marker).first().waitFor({ state: "visible", timeout: 30_000 });
  }

  if (screen.id === "home") {
    const button90d = page.getByRole("button", { exact: true, name: "90D" });

    await button90d.waitFor({ state: "visible", timeout: 15_000 });
    await button90d.click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (button) =>
            button.textContent.trim() === "90D" && button.getAttribute("aria-pressed") === "true",
        ),
      null,
      { timeout: 10_000 },
    );
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

  const browser = await chromium.launch();

  try {
    const storageState = await signInDemo(browser, server.url);

    polishDemoVideoDatabase(databasePath);

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
