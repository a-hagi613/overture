import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";
import { brandSheetHtml, digestEmailHtml, sampleEmailHtml } from "./canvas-email-brand.fixture.ts";

const OUT = join(process.cwd(), "test-results", "canvas-email-brand");

function brandContentType(file: string) {
  if (file.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (file.endsWith(".ico")) {
    return "image/x-icon";
  }

  return "image/png";
}

async function assertNoOverflowAt(page: Page, width: number) {
  await page.setViewportSize({ height: 900, width });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow, `horizontal overflow at ${String(width)}px`).toBeLessThanOrEqual(0);
}

test.describe("canvas parity: email and brand", () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const width of [390, 1280] as const) {
      test(`the rendered recap email matches the board at ${String(width)} ${scheme}`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          colorScheme: scheme,
          deviceScaleFactor: 1,
          viewport: { height: 1200, width },
        });

        const page = await context.newPage();

        await page.route("**/icons/icon-192.png", async (route) => {
          await route.fulfill({
            body: readFileSync(join(process.cwd(), "public/icons/icon-192.png")),
            contentType: "image/png",
          });
        });
        await page.setContent(sampleEmailHtml(), { waitUntil: "networkidle" });
        await page.waitForTimeout(300);

        await assertNoOverflowAt(page, 390);
        await assertNoOverflowAt(page, 520);
        await assertNoOverflowAt(page, 768);
        await assertNoOverflowAt(page, 1280);
        await assertNoOverflowAt(page, 2560);

        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

        await expect(page.getByText("Good morning.")).toBeVisible();
        await expect(page.getByText("Ready to approve · 10")).toBeVisible();
        await expect(page.getByText("Needs you · 2")).toBeVisible();
        await expect(
          page.getByText("Between 08:00–20:00 your time.", { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "Review and send" })).toBeVisible();

        await page.setViewportSize({ height: 1200, width });
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: join(OUT, `ready-email-${String(width)}-${scheme}.png`),
        });

        await page.setContent(digestEmailHtml(), { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        await assertNoOverflowAt(page, 390);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await expect(
          page.getByText("No new applications are ready to approve this morning."),
        ).toBeVisible();
        await expect(page.getByText("Needs you · 1")).toBeVisible();
        await expect(page.getByText("Sent yesterday · 6 applications")).toBeVisible();

        await page.setViewportSize({ height: 1200, width });
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: join(OUT, `recap-digest-${String(width)}-${scheme}.png`),
        });
        await context.close();
      });
    }
  }

  test("the brand assets render as the board's set", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { height: 900, width: 1280 } });
    const page = await context.newPage();

    const files = [
      "favicon.ico",
      "favicon.svg",
      "favicon-16.png",
      "favicon-32.png",
      "favicon-48.png",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-512-maskable.png",
      "avatar-400.png",
      "og-image.png",
      "twitter-card.png",
      "logo-horizontal-paper.svg",
      "logo-horizontal-ink.svg",
      "logo-stacked-paper.svg",
      "logo-stacked-ink.svg",
    ];

    await Promise.all(
      files.map(async (file) => {
        await page.route(`**/icons/${file}`, async (route) => {
          await route.fulfill({
            body: readFileSync(join(process.cwd(), "public/icons", file)),
            contentType: brandContentType(file),
          });
        });
      }),
    );

    await page.setContent(brandSheetHtml(), { waitUntil: "networkidle" });

    await page.setViewportSize({ height: 900, width: 390 });
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: join(OUT, "brand-assets-390.png"),
    });

    await page.setViewportSize({ height: 900, width: 1280 });
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: join(OUT, "brand-assets-1280.png"),
    });

    await context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const width of [390, 1280] as const) {
      test(`the Settings notifications page matches the board at ${String(width)} ${scheme}`, async ({
        browser,
        appServerUrl,
        chromeOwnerStorage,
      }) => {
        const context = await browser.newContext({
          storageState: chromeOwnerStorage,
          viewport: { height: 900, width },
        });

        const page = await context.newPage();

        await page.goto(`${appServerUrl}/settings`);
        await page.evaluate((theme) => {
          globalThis.localStorage.setItem("overture.theme", theme);
        }, scheme);
        await page.goto(`${appServerUrl}/settings`);
        await expect(page.getByRole("heading", { name: /Your\s+Settings/u })).toBeVisible();

        await assertNoOverflowAt(page, 390);
        await assertNoOverflowAt(page, 768);
        await assertNoOverflowAt(page, 1024);
        await assertNoOverflowAt(page, 1280);
        await assertNoOverflowAt(page, 1440);
        await assertNoOverflowAt(page, 1920);
        await assertNoOverflowAt(page, 2560);

        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

        await expect(
          page.getByRole("switch", { name: "Send me the recap email", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("switch", { name: "Include yesterday", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("switch", { name: "A card moved automatically", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { name: "This device" })).toBeVisible();

        await page.setViewportSize({ height: 900, width });
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: join(OUT, `settings-notifications-${String(width)}-${scheme}.png`),
        });
        await context.close();
      });
    }
  }
});
