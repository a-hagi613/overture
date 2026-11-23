import { expect, test } from "./app.fixture.ts";

test("a failed lazy route renders the error card, not a blank page", async ({
  appServerUrl,
  browser,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.route("**/assets/home-*.js", async (route) => {
    await route.abort();
  });
  await page.goto(`${appServerUrl}/home`);

  await expect(page.getByRole("heading", { name: /Something went wrong/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("#main-content")).toHaveCount(1);

  await context.close();
});
