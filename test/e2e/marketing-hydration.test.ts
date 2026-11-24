import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "./app.fixture.ts";
import { marketingRoot, startMarketingSite } from "./marketing-worker.fixture.ts";
import { assetReferences } from "../../scripts/verify-marketing-assets.ts";

function mainAssets(file: string) {
  return [
    ...new Set(
      [...readFileSync(file, "utf8").matchAll(/\/assets\/(?:main-[^/"]+\.(?:js|css))/gu)].map(
        (match) => match[0],
      ),
    ),
  ].toSorted();
}

test("every asset dist-marketing references exists in the app build the origin serves", () => {
  const references = assetReferences(readFileSync(join(marketingRoot, "index.html"), "utf8"));

  expect(references.length).toBeGreaterThan(0);
  expect(references.some((reference) => /\/assets\/main-[^/]+\.js$/u.test(reference))).toBe(true);

  for (const reference of references) {
    expect(existsSync(join("dist", reference)), `${reference} is missing from dist/`).toBe(true);
  }
});

function mainScript(file: string) {
  return mainAssets(file).find((asset) => asset.endsWith(".js"));
}

test("the app shell, the prerendered page and the marketing page name the same bundle", () => {
  const shell = mainAssets("dist/index.html");

  expect(shell.length).toBeGreaterThanOrEqual(2);
  expect(mainAssets("dist/app-shell.html")).toEqual(shell);

  for (const file of ["dist/app-shell.html", join(marketingRoot, "index.html")]) {
    expect(mainScript(file), file).toBe(mainScript("dist/index.html"));
  }
});

test("the prerendered landing hydrates cleanly, shows a live count and ticks the hero counter", async ({
  appServer,
  page,
}) => {
  const site = startMarketingSite(appServer.url);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  const supplyStatuses: number[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());

    if (url.pathname === "/api/supply") {
      supplyStatuses.push(response.status());
    }

    if (response.status() >= 400) {
      failedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });

  try {
    await page.goto(`${site.base}/`, { waitUntil: "networkidle" });

    const supplyCount = page.getByTestId("supply-count");

    await expect(supplyCount).toHaveText(/^[\d,]+$/u);
    expect(supplyStatuses).toContain(200);
    await expect(page.getByTestId("supply-status")).toBeVisible();

    const heroCounter = page.getByTestId("hero-counter-value");
    const firstCount = (await heroCounter.textContent())?.trim() ?? "";

    expect(firstCount).toMatch(/^\d{1,3}(?:,\d{3})*$/u);
    await expect(page.getByTestId("hero-counter")).toBeVisible();
    await expect(heroCounter).not.toHaveText(firstCount, { timeout: 15_000 });

    const howItWorks = page.locator("#how-it-works");

    await expect(howItWorks).toBeVisible();
    await howItWorks.scrollIntoViewIfNeeded();
    await expect(howItWorks.locator("h2")).toBeVisible();
    await expect(howItWorks.getByText("1", { exact: true })).toBeVisible();
    await expect(howItWorks.getByText("3", { exact: true })).toBeVisible();

    expect(failedResponses).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await site.stop();
  }
});
