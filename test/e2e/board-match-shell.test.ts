import { expect, test } from "./app.fixture.ts";

const chrome = [
  {
    parts: [
      { clip: { x: 0, y: 0, width: 390, height: 262 }, file: "header", part: "header" },
      { clip: { x: 0, y: 836, width: 390, height: 64 }, file: "tabbar", part: "tab bar" },
    ],
    viewportHeight: 900,
    width: 390,
  },
  {
    parts: [
      { clip: { x: 0, y: 0, width: 268, height: 1197 }, file: "sidebar", part: "sidebar" },
      { clip: { x: 268, y: 0, width: 1012, height: 140 }, file: "header", part: "header" },
    ],
    viewportHeight: 1197,
    width: 1280,
  },
];

for (const { parts, viewportHeight, width } of chrome) {
  for (const theme of ["light", "dark"]) {
    for (const part of parts) {
      test(`the ${String(width)} ${theme} ${part.part} chrome matches the home board`, async ({
        appServerUrl,
        browser,
        chromeOwnerStorage,
      }) => {
        const context = await browser.newContext({
          deviceScaleFactor: 1,
          storageState: chromeOwnerStorage,
          viewport: { width, height: viewportHeight },
        });

        const page = await context.newPage();

        await page.clock.setFixedTime(new Date(2026, 10, 17, 3, 0, 0));

        if (theme === "dark") {
          await page.addInitScript(() => {
            globalThis.localStorage.setItem("overture.theme", "dark");
          });
        }

        await page.goto(`${appServerUrl}/`);
        await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });

        await expect(page).toHaveScreenshot(`home-${String(width)}-${theme}-${part.file}.png`, {
          animations: "disabled",
          caret: "hide",
          clip: {
            height: part.clip.height,
            width: part.clip.width,
            x: part.clip.x,
            y: part.clip.y,
          },
          maxDiffPixelRatio: 0.01,
        });

        await context.close();
      });
    }
  }
}
