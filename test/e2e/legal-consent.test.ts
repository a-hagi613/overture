import type { Page } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import { startFreshAppServer, expect, test as appTest } from "./app.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";

const consentStateSchema = z.object({
  accepted: z.object({ at: z.string(), version: z.string() }).nullable(),
  current: z.object({ publishedAt: z.string(), text: z.string(), version: z.string() }),
});

const consentVersionsSchema = z.object({
  versions: z.array(z.object({ publishedAt: z.string(), text: z.string(), version: z.string() })),
});

const test = appTest.extend<{ legalServer: AppServer }>({
  legalServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

test("a signed-out visitor reaches the Terms and the Privacy Policy from sign-in", async ({
  page,
  appServerUrl,
}) => {
  await page.goto(`${appServerUrl}/signin`);
  await page.getByRole("link", { name: "Terms" }).click();

  await expect(page).toHaveURL(/\/terms$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText("[POSTAL ADDRESS]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "admin@tryoverture.com" }).first()).toBeVisible();

  const termsResults = await new AxeBuilder({ page }).analyze();

  expect(termsResults.violations).toEqual([]);

  await page.getByRole("link", { name: "Privacy Policy" }).click();

  await expect(page).toHaveURL(/\/privacy$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Stripe" })).toBeVisible();

  await Promise.all(
    [
      /\bFly\b/u,
      /\bCloudflare\b/u,
      /\bBrowser Use\b/u,
      /\bKernel\b/u,
      /\bAnthropic\b/u,
      /\bGrafana Cloud\b/u,
    ].map(async (vendorPattern) =>
      expect(page.locator("main").getByText(vendorPattern)).toHaveCount(0),
    ),
  );

  await expect(page.getByRole("link", { name: "admin@tryoverture.com" }).first()).toBeVisible();

  const privacyResults = await new AxeBuilder({ page }).analyze();

  expect(privacyResults.violations).toEqual([]);

  await page.getByRole("link", { name: "Terms of Service" }).click();

  await expect(page).toHaveURL(/\/terms$/u);
});

test("the legal pages cover billing, trial terms, and corporate disclosures without vendor leaks", async ({
  page,
  appServerUrl,
}) => {
  await page.goto(`${appServerUrl}/terms`);

  await Promise.all(
    [
      "6. Subscription Plans, Allowances, and Beta Invitations",
      "7. Free Trial Eligibility and Card Verification",
      "8. Automatic Renewal, Expiration, and Payment Failures",
      "9. Cancellation and Plan Modifications",
      "10. Refunds and Failed Submission Protections",
    ].map(async (heading) =>
      expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible(),
    ),
  );

  await expect(page.getByText(/\$9\.99/u).first()).toBeVisible();
  await expect(page.getByText(/\$29\.99/u).first()).toBeVisible();
  await expect(page.getByText(/one trial per payment instrument/u).first()).toBeVisible();
  await expect(page.getByText(/automatically renews/u).first()).toBeVisible();
  await expect(page.getByText(/non-refundable once charged/u).first()).toBeVisible();
  await expect(
    page
      .getByText(
        /does not consume your application allowance and incurs no per-application charge/u,
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/charged through Stripe/u).first()).toBeVisible();
  await expect(page.getByText("Published by Overture Inc.", { exact: false })).toBeVisible();

  await page.goto(`${appServerUrl}/privacy`);

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "6. Payment Processing and Trial Card Fingerprinting",
    }),
  ).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Stripe" })).toBeVisible();
  await expect(page.getByText(/as a payment sub-processor/u).first()).toBeVisible();
  await expect(page.getByText(/keyed cryptographic fingerprint/u).first()).toBeVisible();
  await expect(page.getByText("Published by Overture Inc.", { exact: false })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});

test("the consent is versioned, the accepted version is on the profile, and older versions stay unchanged", async ({
  browser,
  legalServer,
}) => {
  const { owner } = await ownerContextFor(legalServer.url);

  const initial = await owner.get("/api/consent");

  expect(initial.ok()).toBe(true);

  const first = consentStateSchema.parse(await initial.json());

  expect(first).toEqual({
    accepted: null,
    current: {
      publishedAt: expect.any(String),
      text: expect.stringContaining("Applications come from my trial or plan"),
      version: "2",
    },
  });

  const seeded = consentVersionsSchema.parse(
    await (await owner.get("/api/consent/versions")).json(),
  );

  expect(seeded.versions).toEqual([
    first.current,
    {
      publishedAt: "2026-11-21T00:00:00.000Z",
      text: "Overture fills in each application for me from the resume and facts I saved. It sends an application only after I approve it, and the answers, resume and cover letter it sends are the ones I approved.",
      version: "1",
    },
  ]);

  const storageState = await owner.storageState();
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  await page.goto(`${legalServer.url}/consent`);

  await expect(page.getByRole("heading", { level: 1, name: "What you agree to" })).toBeVisible();
  await expect(page.getByText("Version 2")).toBeVisible();
  await expect(page.getByText(first.current.text)).toBeVisible();

  const consentResults = await new AxeBuilder({ page }).analyze();

  expect(consentResults.violations).toEqual([]);

  await page.getByRole("checkbox", { name: "I agree to this." }).click();

  await expect(page.getByRole("checkbox", { name: "I agree to this." })).toBeChecked();

  const acceptedFirst = async () => {
    const state = await owner.get("/api/consent");

    return consentStateSchema.parse(await state.json());
  };

  await expect.poll(async () => (await acceptedFirst()).accepted?.version).toBe("2");

  await page.goto(`${legalServer.url}/settings`);

  await expect(page.getByText("Terms and privacy")).toBeVisible();
  await expect(page.getByText("The version you agreed to: 2")).toBeVisible();
  await expect(page.getByText(/Agreed .*2026/u)).toBeVisible();

  const settingsResults = await new AxeBuilder({ page }).analyze();

  expect(settingsResults.violations).toEqual([]);

  await page.locator("#legal").getByRole("link", { exact: true, name: "Open" }).first().click();

  await expect(page).toHaveURL(/\/terms$/u);

  const firstPublishedAt = new Date(first.current.publishedAt).getTime();

  const backwards = await owner.post("/__test__/consent/publish", {
    data: {
      publishedAt: firstPublishedAt - 86_400_000,
      text: "A later consent wording for the next version.",
    },
  });

  expect(backwards.ok()).toBe(true);
  expect(z.object({ version: z.string() }).parse(await backwards.json()).version).toBe("3");

  const afterBackwards = consentStateSchema.parse(await (await owner.get("/api/consent")).json());

  expect(afterBackwards.current.version).toBe("3");
  expect(afterBackwards.accepted?.version).toBe("2");

  const backwardsVersions = consentVersionsSchema.parse(
    await (await owner.get("/api/consent/versions")).json(),
  );

  expect(backwardsVersions.versions.map((version) => version.version)).toEqual(["3", "2", "1"]);
  expect(backwardsVersions.versions[0]?.text).toBe("A later consent wording for the next version.");

  const tied = await owner.post("/__test__/consent/publish", {
    data: { publishedAt: firstPublishedAt, text: "A third consent wording." },
  });

  expect(tied.ok()).toBe(true);
  expect(z.object({ version: z.string() }).parse(await tied.json()).version).toBe("4");

  const afterTie = consentStateSchema.parse(await (await owner.get("/api/consent")).json());

  expect(afterTie.current.version).toBe("4");
  expect(afterTie.accepted?.version).toBe("2");

  const versions = consentVersionsSchema.parse(
    await (await owner.get("/api/consent/versions")).json(),
  );

  expect(versions.versions.map((version) => version.version)).toEqual(["4", "3", "2", "1"]);
  expect(versions.versions[2]?.text).toBe(first.current.text);
  expect(versions.versions[3]).toEqual(seeded.versions[1]);

  const updateRefusal = await owner.post("/__test__/consent/tamper", {
    data: { action: "update" },
  });

  const deleteRefusal = await owner.post("/__test__/consent/tamper", {
    data: { action: "delete" },
  });

  expect(z.object({ refused: z.boolean() }).parse(await updateRefusal.json()).refused).toBe(true);
  expect(z.object({ refused: z.boolean() }).parse(await deleteRefusal.json()).refused).toBe(true);

  await page.goto(`${legalServer.url}/consent`);

  await expect(page.getByRole("heading", { name: "Earlier versions" })).toBeVisible();
  await expect(page.getByText("A third consent wording.")).toBeVisible();
  await expect(page.getByText("A later consent wording for the next version.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "I agree to this." })).not.toBeChecked();

  await page.getByRole("checkbox", { name: "I agree to this." }).click();

  await expect.poll(async () => (await acceptedFirst()).accepted?.version).toBe("4");

  await context.close();
  await owner.dispose();
});

const widths = [390, 768, 1280, 1920, 2560] as const;

async function expectNoSidewaysScroll(page: Page, url: string, label: string) {
  await page.goto(url);
  await expect(page.locator("main").first()).toBeVisible();

  const layout = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(layout.scroll, label).toBeLessThanOrEqual(layout.client);
  expect(layout.body, label).toBeLessThanOrEqual(layout.client);
}

test("the legal pages and the consent fit every width without sideways scroll", async ({
  browser,
  appServerUrl,
}) => {
  await Promise.all(
    widths.map(async (width) => {
      const context = await browser.newContext({ viewport: { height: 900, width } });

      await Promise.all(
        (["/terms", "/privacy", "/consent"] as const).map(async (path) => {
          const page = await context.newPage();

          await expectNoSidewaysScroll(
            page,
            `${appServerUrl}${path}`,
            `${path} at ${String(width)}px`,
          );
          await page.close();
        }),
      );

      await context.close();
    }),
  );
});

test("the legal page links are at least 44 CSS px tall at 390", async ({
  browser,
  appServerUrl,
}) => {
  const context = await browser.newContext({ viewport: { height: 900, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${appServerUrl}/terms`);

  const legalLinks = page.getByRole("navigation", { name: "Legal pages" });

  const controls = [
    page.getByRole("link", { name: "Back to Overture" }),
    legalLinks.getByRole("link", { name: "Terms of Service" }),
    legalLinks.getByRole("link", { name: "Privacy Policy" }),
  ];

  const heights = await Promise.all(
    controls.map(async (control) => (await control.boundingBox())?.height ?? 0),
  );

  for (const height of heights) {
    expect(height).toBeGreaterThanOrEqual(44);
  }

  await context.close();
});

test("Settings fits every width without sideways scroll", async ({
  browser,
  ownerStorageState,
  appServerUrl,
}) => {
  await Promise.all(
    widths.map(async (width) => {
      const context = await browser.newContext({
        storageState: ownerStorageState,
        viewport: { height: 900, width },
      });

      const page = await context.newPage();

      await expectNoSidewaysScroll(
        page,
        `${appServerUrl}/settings`,
        `Settings at ${String(width)}px`,
      );
      await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();

      await context.close();
    }),
  );
});
