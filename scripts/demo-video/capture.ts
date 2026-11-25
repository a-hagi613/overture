import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import { z } from "zod";

import type { Browser, Locator, Page } from "@playwright/test";

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
import { captureMetricsSchema } from "./remotion/metrics.ts";
import type { CaptureMetrics, CoordPoint, RectBox, SizeMetrics } from "./remotion/metrics.ts";

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

interface CaptureSize {
  deviceScaleFactor: number;
  height: number;
  suffix: "desktop" | "mobile";
  width: number;
}

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

function cleanStaleCaptures() {
  if (!existsSync(OUTPUT_DIR)) {
    return;
  }

  for (const file of readdirSync(OUTPUT_DIR)) {
    if (file.endsWith(".png") || file === "metrics.json") {
      unlinkSync(join(OUTPUT_DIR, file));
    }
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
    sqlite.prepare("UPDATE users SET role = 'user' WHERE email = ?").run(demoLoginEmail);

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

function clearCurrentResume(databasePath: string) {
  const sqlite = new DatabaseSync(databasePath);

  try {
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite
      .prepare(
        "UPDATE resumes SET is_current = 0 WHERE user_id = (SELECT id FROM users WHERE email = ?)",
      )
      .run(demoLoginEmail);
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

async function settle(page: Page, pauseMs = 350) {
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

  if (pauseMs > 0) {
    await page.waitForTimeout(pauseMs);
  }
}

async function measureBox(locator: Locator, name: string) {
  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error(`Missing bounding box for ${name}`);
  }

  return box;
}

function normalizeCenter(
  box: { height: number; width: number; x: number; y: number },
  size: CaptureSize,
) {
  return [
    Number(((box.x + box.width / 2) / size.width).toFixed(4)),
    Number(((box.y + box.height / 2) / size.height).toFixed(4)),
  ] satisfies CoordPoint;
}

function normalizeRect(
  box: { height: number; width: number; x: number; y: number },
  size: CaptureSize,
) {
  return {
    height: Number((box.height / size.height).toFixed(4)),
    width: Number((box.width / size.width).toFixed(4)),
    x: Number((box.x / size.width).toFixed(4)),
    y: Number((box.y / size.height).toFixed(4)),
  } satisfies RectBox;
}

async function captureViewport(page: Page, filename: string) {
  const file = join(OUTPUT_DIR, filename);

  await page.screenshot({ animations: "disabled", caret: "hide", path: file });
  process.stdout.write(`captured ${file}\n`);
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

async function captureHomeScene(page: Page, appUrl: string, size: CaptureSize) {
  await page.goto(`${appUrl}/home`, { waitUntil: "load" });
  await page
    .getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

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

  await settle(page, 450);
  await captureViewport(page, `home-${size.suffix}.png`);
}

async function setOverlayVisibility(page: Page, hidden: boolean) {
  await page.evaluate((hide) => {
    const overlay = document.querySelector<HTMLElement>(".cursor-grabbing");

    if (overlay !== null) {
      overlay.style.visibility = hide ? "hidden" : "";
    }
  }, hidden);
}

async function captureTrackerScene(page: Page, appUrl: string, size: CaptureSize) {
  await page.goto(`${appUrl}/tracker`, { waitUntil: "load" });
  await page
    .getByRole("heading", { level: 1, name: /Application\s*Tracker/iu })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  if (size.suffix === "mobile") {
    await page.getByRole("button", { exact: true, name: "Board" }).click();
  }

  const appliedFirstCard = page.locator('section[data-stage="applied"] button[data-card]').first();

  await appliedFirstCard.waitFor({ state: "visible", timeout: 30_000 });
  await settle(page, 400);

  await captureViewport(page, `tracker-before-${size.suffix}.png`);

  const cardBox = await measureBox(appliedFirstCard, `tracker applied card (${size.suffix})`);
  const cardStart = normalizeCenter(cardBox, size);
  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 14, startY - 8, { steps: 6 });

  const overlay = page.locator(".cursor-grabbing").first();

  await overlay.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(120);

  const overlayFile = join(OUTPUT_DIR, `tracker-overlay-${size.suffix}.png`);

  await overlay.screenshot({ omitBackground: true, path: overlayFile });
  process.stdout.write(`captured ${overlayFile}\n`);

  const overlayBox = await measureBox(overlay, `tracker drag overlay (${size.suffix})`);

  const overlaySize = [
    Number((overlayBox.width / size.width).toFixed(4)),
    Number((overlayBox.height / size.height).toFixed(4)),
  ] satisfies CoordPoint;

  let targetX: number;
  let targetY: number;
  let dropTarget: CoordPoint;

  if (size.suffix === "desktop") {
    const waitingBox = await measureBox(
      page.locator('section[data-stage="waiting"]').first(),
      "tracker interviews column (desktop)",
    );

    targetX = waitingBox.x + waitingBox.width / 2;
    targetY = startY;
    dropTarget = [Number((targetX / size.width).toFixed(4)), cardStart[1]] satisfies CoordPoint;
  } else {
    const mobileTab = page
      .locator("fieldset button")
      .filter({ hasText: /^Interviews$/u })
      .first();

    const targetBox = await measureBox(mobileTab, `tracker drop target (${size.suffix})`);

    targetX = targetBox.x + targetBox.width / 2;
    targetY = targetBox.y + targetBox.height / 2;
    dropTarget = normalizeCenter(targetBox, size);
  }

  await setOverlayVisibility(page, true);
  await captureViewport(page, `tracker-drag-backdrop-${size.suffix}.png`);

  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.waitForTimeout(160);
  await captureViewport(page, `tracker-over-${size.suffix}.png`);

  await setOverlayVisibility(page, false);
  await page.mouse.up();

  await page.getByText(/Moved .* to Interviews/u).waitFor({ state: "visible", timeout: 10_000 });

  if (size.suffix === "mobile") {
    await page
      .locator("fieldset button")
      .filter({ hasText: /^Interviews$/u })
      .first()
      .click();
    await page
      .locator('section[data-stage="waiting"] button[data-card]')
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  }

  await settle(page, 250);
  await captureViewport(page, `tracker-after-${size.suffix}.png`);

  return { cardStart, dropTarget, overlaySize };
}

async function captureInboxScene(page: Page, appUrl: string, size: CaptureSize) {
  await page.goto(`${appUrl}/inbox`, { waitUntil: "load" });
  await page
    .getByRole("heading", { level: 1, name: /Inbox/iu })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  const umbraRow = page
    .locator("aside button")
    .filter({ hasText: /Umbra Health/u })
    .first();

  await umbraRow.waitFor({ state: "visible", timeout: 30_000 });
  await settle(page, 400);

  await captureViewport(page, `inbox-before-${size.suffix}.png`);

  const rowBox = await measureBox(umbraRow, `Umbra Health inbox row (${size.suffix})`);
  const inboxRow = normalizeCenter(rowBox, size);

  await umbraRow.click();
  await page
    .getByText(/We are delighted to send you an offer/u)
    .waitFor({ state: "visible", timeout: 15_000 });

  await settle(page, 350);
  await captureViewport(page, `inbox-after-${size.suffix}.png`);

  return { inboxRow };
}

async function captureScanSteps(page: Page, suffix: CaptureSize["suffix"], index: number) {
  if (index >= 3) {
    return;
  }

  await page
    .locator('[data-testid="resume-scan"] ul li svg')
    .nth(index)
    .waitFor({ state: "visible", timeout: 6000 });
  await captureViewport(page, `resume-scan-${String(index + 1)}-${suffix}.png`);
  await captureScanSteps(page, suffix, index + 1);
}

async function captureResumeScene(
  page: Page,
  appUrl: string,
  databasePath: string,
  size: CaptureSize,
) {
  clearCurrentResume(databasePath);

  await page.goto(`${appUrl}/profile/resume`, { waitUntil: "load" });
  await page
    .getByRole("heading", { level: 1, name: /Resume & Cover Letter/iu })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  const uploadBtn = page.getByRole("button", { name: /Upload PDF/iu }).first();

  await uploadBtn.waitFor({ state: "visible", timeout: 15_000 });
  await settle(page, 350);

  const btnBox = await measureBox(uploadBtn, `Upload PDF button (${size.suffix})`);
  const uploadButton = normalizeCenter(btnBox, size);

  await captureViewport(page, `resume-empty-${size.suffix}.png`);

  await page.addStyleTag({ content: ".ov-resume-scan-bar { opacity: 0 !important; }" });

  const resumeBuffer = readFileSync("test/e2e/fixtures/resume-text.pdf");

  await page.locator('#profile-resume input[type="file"]').setInputFiles({
    buffer: resumeBuffer,
    mimeType: "application/pdf",
    name: "sam-rivera-resume.pdf",
  });

  const scanRoot = page.getByTestId("resume-scan");

  await scanRoot.waitFor({ state: "visible", timeout: 10_000 });

  const docBox = await measureBox(
    page.locator('[data-testid="resume-scan"] > div.relative').first(),
    `resume scan document preview (${size.suffix})`,
  );

  const scanBox = normalizeRect(docBox, size);

  await captureViewport(page, `resume-scan-0-${size.suffix}.png`);
  await captureScanSteps(page, size.suffix, 0);

  await scanRoot.waitFor({ state: "hidden", timeout: 10_000 });
  await page
    .getByRole("button", { name: /Replace resume/iu })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await settle(page, 250);
  await captureViewport(page, `resume-done-${size.suffix}.png`);

  return { scanBox, uploadButton };
}

async function runForSize(browser: Browser, scratchRoot: string, size: CaptureSize) {
  const sizeScratch = join(scratchRoot, size.suffix);

  mkdirSync(sizeScratch, { recursive: true });

  const databasePath = join(sizeScratch, "overture.db");

  copyTemplateDatabases(databasePath);

  const server = await startAppServer(databasePath, {
    DEMO_LOGIN_ENABLED: "true",
    MASTER_KEY_CURRENT: "1",
    MASTER_KEY_V1: authTestIdentity.masterKey,
    OBJECT_STORE_ROOT: join(sizeScratch, "objects"),
  });

  try {
    const storageState = await signInDemo(browser, server.url);

    polishDemoVideoDatabase(databasePath);

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

    await captureHomeScene(page, server.url, size);
    const tracker = await captureTrackerScene(page, server.url, size);
    const inbox = await captureInboxScene(page, server.url, size);
    const resume = await captureResumeScene(page, server.url, databasePath, size);

    await context.close();

    return {
      cardStart: tracker.cardStart,
      dropTarget: tracker.dropTarget,
      inboxRow: inbox.inboxRow,
      overlaySize: tracker.overlaySize,
      scanBox: resume.scanBox,
      uploadButton: resume.uploadButton,
    } satisfies SizeMetrics;
  } finally {
    await server.stop();
  }
}

async function main() {
  buildApp();
  ensureTemplateDatabases();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  cleanStaleCaptures();

  const scratch = mkdtempSync(join(tmpdir(), "overture-demo-video-"));
  const browser = await chromium.launch();

  try {
    const [desktopSize, mobileSize] = SIZES;

    if (desktopSize === undefined || mobileSize === undefined) {
      throw new Error("Expected desktop and mobile sizes");
    }

    const desktop = await runForSize(browser, scratch, desktopSize);
    const mobile = await runForSize(browser, scratch, mobileSize);

    const metrics: CaptureMetrics = captureMetricsSchema.parse({ desktop, mobile });
    const metricsFile = join(OUTPUT_DIR, "metrics.json");

    writeFileSync(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`);
    process.stdout.write(`wrote ${metricsFile}\n`);
  } finally {
    await browser.close();
  }
}

await main();
