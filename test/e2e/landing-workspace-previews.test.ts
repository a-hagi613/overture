import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const screens = [
  { label: "Home", slug: "home" },
  { label: "Applications", slug: "board" },
  { label: "Inbox", slug: "inbox" },
  { label: "Calendar", slug: "calendar" },
  { label: "Profile", slug: "profile" },
] as const;

type ScreenSlug = (typeof screens)[number]["slug"];

type Theme = "dark" | "light";

const PREVIEW_GROUP = "Workspace preview screens";

async function openPreview(
  browser: Browser,
  appUrl: string,
  viewport: { height: number; width: number },
) {
  const context = await browser.newContext({ colorScheme: "light", viewport });
  const page = await context.newPage();

  await page.goto(`${appUrl}/#dashboard-preview`, { waitUntil: "load" });
  await page.locator("#dashboard-preview").scrollIntoViewIfNeeded();

  return { context, page };
}

function visiblePreview(page: Page) {
  return page.locator("#dashboard-preview img:visible");
}

async function previewNaturalWidth(page: Page) {
  return page.evaluate(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>("#dashboard-preview img")];
    const visible = images.find((image) => image.getClientRects().length > 0);

    return visible?.naturalWidth ?? 0;
  });
}

async function expectNoBrokenImages(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const images = [...document.querySelectorAll<HTMLImageElement>("#dashboard-preview img")];

        return images.length > 0 && images.every((image) => image.naturalWidth > 0);
      }),
    )
    .toBe(true);
}

async function expectPreview(page: Page, slug: ScreenSlug, theme: Theme, mobile: boolean) {
  const suffix = mobile ? "-mobile" : "";
  const image = visiblePreview(page);

  await expect(image).toHaveAttribute("src", `/previews/${slug}${suffix}-${theme}.png?v=6`);
  await expect.poll(async () => previewNaturalWidth(page), { timeout: 15_000 }).toBeGreaterThan(0);
}

async function selectScreen(page: Page, label: string) {
  await page
    .getByRole("group", { name: PREVIEW_GROUP })
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function checkScreens(page: Page, theme: Theme, mobile: boolean, index = 0) {
  const screen = screens[index];

  if (screen === undefined) {
    return;
  }

  await selectScreen(page, screen.label);
  await expectPreview(page, screen.slug, theme, mobile);

  const width = await previewNaturalWidth(page);

  if (mobile) {
    expect(width).toBeLessThan(1000);
  } else {
    expect(width).toBeGreaterThanOrEqual(1000);
  }

  await expectNoBrokenImages(page);
  await checkScreens(page, theme, mobile, index + 1);
}

test("desktop landing previews show the refreshed widescreen screenshots", async ({
  appServerUrl,
  browser,
}) => {
  const { context, page } = await openPreview(browser, appServerUrl, { height: 800, width: 1280 });

  await checkScreens(page, "light", false);
  await page.getByRole("button", { name: "Preview dark mode" }).click();
  await checkScreens(page, "dark", false);

  await page.getByRole("button", { name: "Preview light mode" }).click();
  await selectScreen(page, "Home");
  await expectPreview(page, "home", "light", false);

  await context.close();
});

test("mobile landing previews show the refreshed phone screenshots without overflow", async ({
  appServerUrl,
  browser,
}) => {
  const { context, page } = await openPreview(browser, appServerUrl, { height: 844, width: 390 });

  await checkScreens(page, "light", true);
  await page.getByRole("button", { name: "Preview dark mode" }).click();
  await checkScreens(page, "dark", true);

  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth + 1),
    )
    .toBe(true);

  await context.close();
});
