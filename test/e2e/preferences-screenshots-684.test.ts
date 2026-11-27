import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";

import type { Browser, BrowserContextOptions, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const shotDirectory = process.env.PREFERENCES_684_SHOT_DIR;

const SIZES = [
  { height: 1100, width: 1280 },
  { height: 900, width: 390 },
] as const;

const THEMES = ["light", "dark"] as const;

type StorageState = NonNullable<BrowserContextOptions["storageState"]>;

async function openPage(
  browser: Browser,
  appServerUrl: string,
  storageState: StorageState,
  width: number,
  height: number,
  theme: string,
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(appServerUrl);

  return { context, page };
}

async function shoot(page: Page, name: string, locator: ReturnType<Page["locator"]>) {
  mkdirSync(shotDirectory ?? "", { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await locator.screenshot({ path: join(shotDirectory ?? "", `${name}.png`) });
}

appTest("capture the unified Preferences card", async ({ browser, identityServer }) => {
  appTest.skip(shotDirectory === undefined, "only when PREFERENCES_684_SHOT_DIR is set");

  const server = await startFreshAppServer(identityServer);
  const request = await apiRequest.newContext({ baseURL: server.url });

  try {
    await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);
    const link = await latestMailLink(server.url, request, authTestIdentity.ownerEmail);

    await request.get(link);

    const storageState = await request.storageState();

    await request.post("/__test__/jobs/seed", {
      data: {
        jobs: [
          {
            category: "healthcare",
            cities: ["London"],
            company: "Oak Clinic",
            countries: ["gb"],
            public_slug: "shot-registered-nurse",
            title: "Registered Nurse",
          },
          {
            category: "healthcare",
            cities: ["London"],
            company: "Oak Clinic",
            countries: ["gb"],
            public_slug: "shot-nurse-practitioner",
            title: "Nurse Practitioner",
          },
          {
            category: "backend",
            cities: ["London"],
            company: "CloudBridge",
            countries: ["gb"],
            public_slug: "shot-backend-engineer",
            title: "Backend Engineer",
          },
        ],
      },
    });

    const captures = SIZES.flatMap(({ width, height }) =>
      THEMES.map((theme) => ({ height, theme, width })),
    );

    await Promise.all(
      captures.map(async ({ width, height, theme }) => {
        const { context, page } = await openPage(
          browser,
          server.url,
          storageState,
          width,
          height,
          theme,
        );

        await page.goto(`${server.url}/onboarding/targets`);
        await expect(page.getByTestId("onboarding-targets-status")).toBeVisible();

        if ((await page.getByRole("button", { name: "Remove Healthcare" }).count()) === 0) {
          await page.getByRole("button", { name: /^Add a role category/u }).click();
          await page.getByRole("option", { exact: true, name: "Healthcare" }).click();
        }

        if ((await page.getByRole("button", { name: "Remove nurse" }).count()) === 0) {
          await page.getByRole("textbox", { name: "Title words" }).fill("nurse");
          await page.getByRole("button", { name: "Add word" }).click();
        }

        if ((await page.getByRole("button", { name: "Remove London" }).count()) === 0) {
          await page.getByRole("button", { name: "Locations" }).click();
          await page.getByPlaceholder("Search cities or remote regions...").fill("London");
          await page
            .getByRole("option", { name: /^London/u })
            .first()
            .click();
        }

        await expect(page.getByTestId("onboarding-targets-status")).toHaveText(
          "2 open roles match",
        );

        await shoot(
          page,
          `onboarding-preferences-${String(width)}-${theme}`,
          page.locator('[aria-labelledby="ob-h"]'),
        );
        await context.close();

        const profile = await openPage(browser, server.url, storageState, width, height, theme);

        await profile.page.goto(`${server.url}/profile/preferences`);
        await expect(profile.page.getByTestId("targets-matched-count")).toHaveText("2");

        await shoot(
          profile.page,
          `profile-preferences-${String(width)}-${theme}`,
          profile.page.locator("#profile-targets"),
        );
        await profile.context.close();
      }),
    );
  } finally {
    await request.dispose();
    await server.stop();
  }
});
