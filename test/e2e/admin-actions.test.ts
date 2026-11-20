import { enableVirtualAuthenticator, signInOwnerOnAdmin } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import type { Page } from "@playwright/test";

import { z } from "zod";

const catalogSchema = z.object({
  ats: z.array(z.object({ ats: z.string(), killSwitchEnabled: z.boolean().nullable() })),
});

const killSwitchRowSchema = z.object({
  enabled: z.number(),
  key: z.string(),
  reason: z.string(),
  scope: z.string(),
});

async function openAdminAsOwner(
  page: Page,
  adminIsolatedAppUrl: string,
  issueToken: (claims: { email: string }) => Promise<string>,
) {
  await enableVirtualAuthenticator(page);
  await signInOwnerOnAdmin(page, adminIsolatedAppUrl);

  const token = await issueToken({ email: "owner@example.com" });

  await page.context().addCookies([
    {
      name: "CF_Authorization",
      value: token,
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${adminIsolatedAppUrl}/admin/settings`);

  const passkeyGate = page.getByRole("button", { name: "Add your passkey" });

  const gateAppeared = await passkeyGate
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (gateAppeared) {
    await passkeyGate.click();
  }

  await expect(page.getByRole("heading", { name: "Kill switches", exact: true })).toBeVisible();
}

test("a settings change from admin takes effect", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const input = page.getByLabel("Value for limits.daily_cap");

  await input.fill("5");
  await input.locator("xpath=following-sibling::button").click();

  await expect(input).toHaveValue("5");

  const applied = await page.request.get(
    `${adminIsolatedAppServer.url}/api/settings/limits.daily_cap`,
  );

  expect(await applied.json()).toEqual({ key: "limits.daily_cap", value: "5" });
});

test("a kill switch set from admin takes effect and shows on catalog health", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  await page.getByLabel("Scope").selectOption("ats");
  await page.getByLabel("Name", { exact: true }).fill("greenhouse");
  await page.getByLabel("Reason").fill("drill");
  await page.getByRole("button", { name: "Add the kill switch" }).click();

  const switchList = killSwitchRowSchema
    .array()
    .parse(
      await (await page.request.get(`${adminIsolatedAppServer.url}/api/kill-switches`)).json(),
    );

  const greenhouse = switchList.find((row) => row.scope === "ats" && row.key === "greenhouse");

  expect(greenhouse?.enabled).toBe(1);
  expect(greenhouse?.reason).toBe("drill");

  const catalog = await page.request.get(`${adminIsolatedAppUrl}/admin/api/catalog`);

  expect(catalog.status()).toBe(200);

  const catalogBody = catalogSchema.parse(await catalog.json());

  expect(catalogBody.ats.find((entry) => entry.ats === "greenhouse")?.killSwitchEnabled).toBe(true);

  await page.goto(`${adminIsolatedAppUrl}/admin/catalog`);
  await expect(page.getByText("The catalog has not been discovered yet.")).toBeVisible();
  await expect(page.getByText("greenhouse", { exact: true })).toBeVisible();
});

test("every admin action writes an audit row", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const input = page.getByLabel("Value for limits.daily_cap");

  await input.fill("5");
  await input.locator("xpath=following-sibling::button").click();

  await page.getByLabel("Scope").selectOption("global");
  await page.getByLabel("Name", { exact: true }).fill("all");
  await page.getByLabel("Reason").fill("drill");
  await page.getByRole("button", { name: "Add the kill switch" }).click();

  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Recent admin actions" })).toBeVisible();
  await expect(page.getByText("settings.update")).toBeVisible();
  await expect(page.getByText("kill_switch.update")).toBeVisible();

  void adminIsolatedAppServer;
});
