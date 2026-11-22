import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./lab.fixture.ts";

test("the provider report never overflows and keeps its controls usable", async ({
  page,
  labAppUrl,
  accessServer,
}) => {
  test.setTimeout(180_000);

  await openAdminAsOwner(page, labAppUrl, accessServer.issueToken);
  await page.goto(`${labAppUrl}/admin/provider-report`);

  const checks = await Promise.all(
    [390, 768, 1280, 1920, 2560].flatMap((width) =>
      ["light", "dark"].map(async (theme) => {
        const view = await page.context().newPage();

        await view.addInitScript((storageTheme) => {
          globalThis.localStorage.setItem("overture.theme", storageTheme);
        }, theme);
        await view.setViewportSize({ width, height: 900 });
        await view.goto(`${labAppUrl}/admin/provider-report`);
        await expect(view.getByRole("heading", { name: "The provider report" })).toBeVisible();

        const overflow = await view.evaluate(() => ({
          body: document.body.scrollWidth - document.body.clientWidth,
          html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));

        await view.close();

        return { overflow, theme, width };
      }),
    ),
  );

  for (const check of checks) {
    expect(check.overflow, `${String(check.width)} ${check.theme}`).toEqual({ body: 0, html: 0 });
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();

  const runButton = page.getByRole("button", { name: "Run the lab" });
  const sessionsInput = page.getByLabel("Sessions per page and browser");

  await expect(runButton).toHaveCSS("cursor", "pointer");
  await sessionsInput.focus();

  const focusRing = await sessionsInput.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);

    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(focusRing.style).not.toBe("none");

  const targetSizes = await page.evaluate(() =>
    [...document.querySelectorAll("button, input")].map((element) => {
      const rect = element.getBoundingClientRect();

      return { height: Math.round(rect.height), width: Math.round(rect.width) };
    }),
  );

  for (const size of targetSizes) {
    expect(Math.max(size.height, size.width)).toBeGreaterThanOrEqual(24);
  }
});
