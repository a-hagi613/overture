import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";

import type { AppServer } from "./app-server.ts";

import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { vapidKeyPair } from "./push.fixture.ts";

const demoEmail = "test@email.com";
const greetingHeading = /Good (?:morning|afternoon|evening),/u;

async function inSequence<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  const [first, ...rest] = items;

  if (first === undefined) {
    return;
  }

  await run(first);
  await inSequence(rest, run);
}

const test = appTest.extend<{ demoServer: AppServer }>({
  demoServer: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-core-flows-"));
      const anthropic = await startAnthropicFixtureServer();
      const vapid = vapidKeyPair();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: join(directory, "browsers"),
        DEMO_LOGIN_ENABLED: "true",
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_PUBLIC_KEY: vapid.publicKey,
      });

      await provide(server);
      await server.stop();
      anthropic.stop();
    },
    { scope: "test" },
  ],
});

test.describe("core workspace flows on the rebuilt Ember UI", () => {
  test("Home dashboard gates sending during onboarding, switches Line/Bar chart and 7D/30D/90D ranges", async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({
      storageState: ownerStorageState,
      viewport: { height: 900, width: 1280 },
    });

    const page = await context.newPage();

    try {
      await page.goto(`${appServerUrl}/home`);
      await expect(page.getByRole("heading", { level: 1, name: greetingHeading })).toBeVisible();

      const lineTab = page.getByRole("tab", { name: "Line" });
      const barTab = page.getByRole("tab", { name: "Bar" });

      await expect(lineTab).toHaveAttribute("aria-selected", "true");
      await barTab.click();
      await expect(barTab).toHaveAttribute("aria-selected", "true");
      await lineTab.click();
      await expect(lineTab).toHaveAttribute("aria-selected", "true");

      await inSequence(["30D", "90D", "7D"], async (rangeLabel) => {
        const rangeTab = page.getByRole("tab", { name: rangeLabel });

        await rangeTab.click();
        await expect(rangeTab).toHaveAttribute("aria-selected", "true");
      });

      await expect(page.getByRole("button", { name: /Pause sending|Resume sending/u })).toHaveCount(
        0,
      );
      await expect(page.getByRole("link", { name: "Finish setup" }).first()).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("Profile sub-pages persist Cover letter edits, switch Details tiers, show Billing cards, and open Account Settings delete dialog", async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({
      storageState: ownerStorageState,
      viewport: { height: 900, width: 1280 },
    });

    const page = await context.newPage();

    try {
      await page.goto(`${appServerUrl}/profile/resume`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Resume & Cover Letter" }),
      ).toBeVisible();

      const customLetter =
        "Dear {hiring_team} at {company_name},\n\nExcited to bring focused systems engineering to {role_title}.\n\nBest regards,\n{your_name}";

      await page.getByRole("button", { exact: true, name: "Edit" }).click();
      const editor = page.getByRole("textbox", { name: "Cover letter" });

      await expect(editor).toBeVisible();
      await editor.fill(customLetter);

      const savedResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/profile/facts") && response.request().method() === "PUT",
      );

      await page.getByRole("button", { name: "Save cover letter" }).click();
      await savedResponse;

      await expect(page.getByText("Excited to bring focused systems engineering")).toBeVisible();

      await page.reload();
      await expect(page.getByText("Excited to bring focused systems engineering")).toBeVisible();

      await page.goto(`${appServerUrl}/profile/details`);
      await expect(page.getByRole("heading", { level: 1, name: "Personal Details" })).toBeVisible();

      await inSequence(
        [
          /Tier 2 · Strengthen your profile/u,
          /Tier 3 · Learned from Reviews/u,
          /Tier 1 · Needed to start/u,
        ],
        async (tierName) => {
          const tab = page.getByRole("tab", { name: tierName });

          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
        },
      );

      await page.goto(`${appServerUrl}/profile/preferences`);
      await expect(page.getByRole("heading", { level: 1, name: "Job Preferences" })).toBeVisible();

      await page.goto(`${appServerUrl}/profile/billing`);
      await expect(page.getByRole("heading", { level: 1, name: "Plan & Billing" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Manage billing" }).first()).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: /Upgrade to Week|Upgrade to Month|You're on the Month/u,
        }),
      ).toBeVisible();

      await page.goto(`${appServerUrl}/profile/account`);
      await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();
      await page.getByRole("button", { name: "Delete account" }).click();

      const dialog = page.getByRole("dialog");

      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("Job Calendar adds and removes a custom event", async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({
      storageState: ownerStorageState,
      viewport: { height: 900, width: 1280 },
    });

    const page = await context.newPage();

    try {
      await page.goto(`${appServerUrl}/calendar`);
      await expect(page.getByRole("heading", { level: 1, name: "Job Calendar" })).toBeVisible();

      await page.getByRole("button", { name: "Add event" }).click();
      await page.getByLabel("Event title").fill("Staff panel interview");
      await page.getByLabel("Company").fill("Acme Labs");
      await page.getByRole("button", { name: "Save event" }).click();

      const dayPanel = page.getByRole("complementary", { name: "Day panel" });

      await expect(dayPanel.getByText("Staff panel interview")).toBeVisible();
      await expect(dayPanel.getByText("Acme Labs")).toBeVisible();

      await dayPanel.getByRole("button", { name: "Remove event" }).click();
      await expect(dayPanel.getByText("Staff panel interview")).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("Search palette, Notifications, Support, Onboarding preview steps, and 404 page work end-to-end", async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({
      storageState: ownerStorageState,
      viewport: { height: 900, width: 1280 },
    });

    const page = await context.newPage();

    try {
      await page.goto(`${appServerUrl}/home`);
      await page
        .locator("aside")
        .getByRole("button", { name: /Search/u })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();

      await page.goto(`${appServerUrl}/notifications`);
      await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();

      await page.goto(`${appServerUrl}/support`);
      await expect(page.getByRole("heading", { level: 1, name: "Contact Support" })).toBeVisible();

      const previewSteps = [
        { heading: /Welcome/u, path: "/onboarding?preview=1" },
        { heading: /Resume/u, path: "/onboarding/resume?preview=1" },
        { heading: /Personal details/u, path: "/onboarding/facts?preview=1" },
        { heading: /Job preferences/u, path: "/onboarding/targets?preview=1" },
        { heading: /Mail forwarding/u, path: "/onboarding/forward?preview=1" },
      ] as const;

      await inSequence(previewSteps, async (step) => {
        await page.goto(`${appServerUrl}${step.path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("body")).toContainText(step.heading);
        await expect(page.locator("body")).not.toContainText("Skip anything.");
      });

      await page.goto(`${appServerUrl}/nonexistent-route-check`);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
      await page.getByRole("link", { name: "Back to Home" }).click();
      await expect(page).toHaveURL(/\/home$/u);
    } finally {
      await context.close();
    }
  });

  test("Seeded workspace supports Tracker sheet inspection, Ready confirmation modal, Review filters, and Inbox split pane", async ({
    browser,
    demoServer,
  }) => {
    const context = await browser.newContext({ viewport: { height: 900, width: 1280 } });
    const page = await context.newPage();

    try {
      await page.goto(`${demoServer.url}/signin`);
      await page.getByLabel("Email").fill(demoEmail);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      await expect(page.getByRole("heading", { level: 1, name: greetingHeading })).toBeVisible();

      await page.goto(`${demoServer.url}/board`);
      await expect(page.getByRole("heading", { level: 1, name: "Job Tracker" })).toBeVisible();
      await page
        .getByRole("button", { name: /Tidepool Analytics/u })
        .first()
        .click();
      await expect(page.getByRole("dialog", { name: "Application detail" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Timeline" })).toBeVisible();
      await page.keyboard.press("Escape");

      await page.goto(`${demoServer.url}/ready`);
      await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).toBeVisible();
      await page
        .getByRole("button", { name: /Send application/u })
        .first()
        .click();

      const confirmDialog = page.getByRole("dialog");

      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(confirmDialog).toBeHidden();

      await page.goto(`${demoServer.url}/review`);
      await expect(page.getByRole("heading", { level: 1, name: "Your Review" })).toBeVisible();
      await expect(
        page.getByText("What are your salary expectations for this role?").first(),
      ).toBeVisible();

      await page.goto(`${demoServer.url}/inbox`);
      await expect(page.getByRole("heading", { level: 1, name: "Employer Inbox" })).toBeVisible();

      const unreadTab = page.getByRole("tab", { name: /Unread/u });
      const allTab = page.getByRole("tab", { name: /All/u });

      await unreadTab.click();
      await expect(unreadTab).toHaveAttribute("aria-selected", "true");
      await allTab.click();
      await expect(allTab).toHaveAttribute("aria-selected", "true");
    } finally {
      await context.close();
    }
  });

  test("Public legal pages Terms and Privacy render cleanly with zero axe violations", async ({
    browser,
    appServerUrl,
  }) => {
    const context = await browser.newContext({ viewport: { height: 900, width: 1280 } });
    const page = await context.newPage();

    try {
      await inSequence(["/terms", "/privacy"], async (legalPath) => {
        await page.goto(`${appServerUrl}${legalPath}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations, legalPath).toEqual([]);
      });
    } finally {
      await context.close();
    }
  });
});
