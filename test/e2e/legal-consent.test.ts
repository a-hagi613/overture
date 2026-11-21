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
  versions: z.array(z.object({ text: z.string(), version: z.string() })),
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
  await expect(page.getByText("[POSTAL ADDRESS]").first()).toBeVisible();

  const termsResults = await new AxeBuilder({ page }).analyze();

  expect(termsResults.violations).toEqual([]);

  await page.getByRole("link", { name: "Privacy Policy" }).click();

  await expect(page).toHaveURL(/\/privacy$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Browser Use" })).toBeVisible();
  await expect(page.getByRole("link", { name: "admin@tryoverture.com" }).first()).toBeVisible();

  const privacyResults = await new AxeBuilder({ page }).analyze();

  expect(privacyResults.violations).toEqual([]);

  await page.getByRole("link", { name: "Terms of Service" }).click();

  await expect(page).toHaveURL(/\/terms$/u);
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
      text: expect.stringContaining("Overture fills in each application for me"),
      version: "1",
    },
  });

  const storageState = await owner.storageState();
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  await page.goto(`${legalServer.url}/consent`);

  await expect(page.getByRole("heading", { level: 1, name: "What you agree to" })).toBeVisible();
  await expect(page.getByText("Version 1")).toBeVisible();
  await expect(page.getByText(first.current.text)).toBeVisible();

  const consentResults = await new AxeBuilder({ page }).analyze();

  expect(consentResults.violations).toEqual([]);

  await page.getByRole("checkbox", { name: "I agree to this." }).click();

  await expect(page.getByRole("checkbox", { name: "I agree to this." })).toBeChecked();

  const acceptedFirst = async () => {
    const state = await owner.get("/api/consent");

    return consentStateSchema.parse(await state.json());
  };

  await expect.poll(async () => (await acceptedFirst()).accepted?.version).toBe("1");

  await page.goto(`${legalServer.url}/settings`);

  await expect(page.getByText("Terms and privacy")).toBeVisible();
  await expect(page.getByText("The version you agreed to: 1")).toBeVisible();
  await expect(page.getByText(/Agreed .*2026/u)).toBeVisible();

  await page.getByRole("link", { name: "Open" }).first().click();

  await expect(page).toHaveURL(/\/terms$/u);

  const published = await owner.post("/__test__/consent/publish", {
    data: { text: "A later consent wording for the next version." },
  });

  expect(published.ok()).toBe(true);
  expect(z.object({ version: z.string() }).parse(await published.json()).version).toBe("2");

  const afterPublish = consentStateSchema.parse(await (await owner.get("/api/consent")).json());

  expect(afterPublish.current.version).toBe("2");
  expect(afterPublish.accepted?.version).toBe("1");

  const versions = consentVersionsSchema.parse(
    await (await owner.get("/api/consent/versions")).json(),
  );

  expect(versions.versions.map((version) => version.version)).toEqual(["2", "1"]);
  expect(versions.versions[0]?.text).toBe("A later consent wording for the next version.");
  expect(versions.versions[1]?.text).toBe(first.current.text);

  await page.goto(`${legalServer.url}/consent`);

  await expect(page.getByRole("heading", { name: "Earlier versions" })).toBeVisible();
  await expect(page.getByText("A later consent wording for the next version.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "I agree to this." })).not.toBeChecked();

  await page.getByRole("checkbox", { name: "I agree to this." }).click();

  await expect.poll(async () => (await acceptedFirst()).accepted?.version).toBe("2");

  await context.close();
  await owner.dispose();
});
