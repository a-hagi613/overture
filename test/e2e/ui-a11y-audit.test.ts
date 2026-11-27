import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedReady } from "./ready-harness.ts";

const test = appTest.extend<{ auditServer: AppServer }>({
  auditServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

test.use({ trace: "off" });

const SHOT_DIR = join(process.cwd(), "docs/screenshots/ui-a11y-audit");
const widths = [390, 1280] as const;
const themes = ["light", "dark"] as const;

function viewportFor(width: number) {
  return { height: width >= 1024 ? 900 : 844, width };
}

for (const width of widths) {
  for (const theme of themes) {
    test(`captures the accessible Ready drawer and sign-in error at ${String(width)}px ${theme}`, async ({
      browser,
      auditServer,
    }) => {
      mkdirSync(SHOT_DIR, { recursive: true });

      const request = await apiRequest.newContext({ baseURL: auditServer.url });

      await seedReady(request, auditServer.url);

      const storageState = await request.storageState();

      await request.dispose();

      const context = await browser.newContext({
        storageState,
        timezoneId: "America/Toronto",
        viewport: viewportFor(width),
      });

      const page = await context.newPage();

      try {
        if (theme === "dark") {
          await page.addInitScript(() => {
            globalThis.localStorage.setItem("overture.theme", "dark");
          });
        }

        await page.goto(`${auditServer.url}/ready`);
        await expect(page.getByRole("heading", { level: 1, name: "Approval Queue" })).toBeVisible();

        await page.getByRole("button", { name: "Inspect Northwind Labs" }).click();

        const drawer = page.getByRole("dialog", { name: "Inspect prepared application" });

        await expect(drawer).toBeVisible();
        await expect(drawer).toHaveAttribute("aria-modal", "true");
        await page.evaluate(async () => {
          await document.fonts.ready;
        });

        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          path: join(SHOT_DIR, `ready-drawer-${String(width)}-${theme}.png`),
        });

        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);

        await page.goto(`${auditServer.url}/signin?error=forbidden`);
        await expect(page.getByRole("alert").first()).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });

        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          path: join(SHOT_DIR, `signin-error-${String(width)}-${theme}.png`),
        });

        await page.goto(`${auditServer.url}/support`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.getByRole("button", { name: "Send message" }).click();

        const subject = page.getByLabel("Subject");

        await expect(subject).toBeFocused();
        await expect(subject).toHaveAttribute("aria-invalid", "true");
        await expect(subject).toHaveAttribute("aria-describedby", "support-error");
        await page.evaluate(async () => {
          await document.fonts.ready;
        });

        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          path: join(SHOT_DIR, `support-error-${String(width)}-${theme}.png`),
        });
      } finally {
        await context.close();
      }
    });
  }
}
