import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import {
  clearSinkMail,
  requestMagicLink,
  setTurnstileScenario,
  signInByMagicLink,
  verifyAuthState,
} from "./sign-in.ts";

const guestEmail = "guest.admin@example.com";
const revokedEmail = "guest.revoked@example.com";
const suspendReason = "Testing the support drill";

const auditSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      reason: z.string(),
      targetUserId: z.string().nullable(),
    }),
  ),
});

const homeSchema = z.object({
  pauseReason: z.string().nullable(),
});

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, label).toEqual([]);
}

test("the owner invites, grants and suspends a person from the admin", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const appUrl = adminIsolatedAppServer.url;

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await page.goto(`${adminIsolatedAppUrl}/admin/users`);

  await expect(page.getByRole("heading", { name: "Users and access" })).toBeVisible();

  await page.getByRole("link", { name: "Invite someone" }).click();
  await expect(page).toHaveURL(new RegExp(`${adminIsolatedAppUrl}/admin/invites`, "u"));

  await page.getByLabel("Email address").fill(guestEmail);
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText("Pending · 1")).toBeVisible();
  await page.getByLabel("Email address").fill(revokedEmail);
  await page.getByRole("button", { name: "Create invite" }).click();

  await expect(page.getByText("Pending · 2")).toBeVisible();
  await expect(page.getByText(guestEmail)).toBeVisible();

  await page.getByText(revokedEmail).locator("..").getByRole("button", { name: "Revoke" }).click();

  await expect(page.getByText("Revoked · 1")).toBeVisible();
  await expect(page.getByText("Never signed in")).toBeVisible();

  await signInByMagicLink(page, appUrl, page.request, guestEmail);
  await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();

  const state = await verifyAuthState(appUrl, page.request);
  const guest = state.users.find((user) => user.email === guestEmail);

  expect(guest).toBeDefined();

  const members = await page.request.get(`${adminIsolatedAppUrl}/admin/api/users`);

  expect(members.ok()).toBe(true);

  await page.goto(`${adminIsolatedAppUrl}/admin/users`);

  await expect(page.getByRole("heading", { name: "Users and access" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Active 2$/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Invited 0$/u })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search name or email" }).fill(guestEmail);

  await expect(page.getByText(guestEmail)).toBeVisible();
  await expect(page.locator("main").getByText(authTestIdentity.ownerEmail)).toHaveCount(0);

  await page.getByText(guestEmail).locator("..").click();
  await expect(page).toHaveURL(new RegExp(`${adminIsolatedAppUrl}/admin/users/`, "u"));

  const detailUrl = page.url();

  await expect(page.getByText("Read-only. Forward ATS mail here only.")).toBeVisible();
  await expect(page.getByText("Admin grant")).toBeVisible();
  await expect(page.getByText("of 300 left")).toBeVisible();
  await expect(page.getByText("Accepted by sign-in", { exact: false })).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  await expectAxeClean(page, "390px user detail");

  await page.setViewportSize({ height: 900, width: 1280 });
  await expectAxeClean(page, "1280px user detail");

  await page.goto(`${adminIsolatedAppUrl}/admin/grants`);

  await page.getByLabel("Email").fill(guestEmail);
  await page.getByLabel("Applications", { exact: true }).fill("5");

  const grantRows = page.getByText(`${guestEmail} · granted`, { exact: false });

  await expect(grantRows).toHaveCount(1);

  await page.getByRole("button", { name: "Grant the Applications" }).click();
  await expect(grantRows).toHaveCount(2, { timeout: 15_000 });

  await page.goto(detailUrl);

  await expect(page.getByText("of 305 left")).toBeVisible();

  await page.getByLabel("Reason").fill(suspendReason);
  await page.getByRole("button", { name: "Suspend account" }).click();

  await expect(page.getByRole("button", { name: "Reinstate account" })).toBeVisible();
  await expect(page.getByText("Suspended", { exact: true })).toBeVisible();

  const audit = auditSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`)).json(),
  );

  const suspension = audit.audit.find((entry) => entry.action === "users.suspend");

  expect(suspension?.reason).toBe(suspendReason);
  expect(suspension?.targetUserId).toBe(guest?.id);
  expect(audit.audit.some((entry) => entry.action === "invites.create")).toBe(true);
  expect(audit.audit.some((entry) => entry.action === "invites.revoke")).toBe(true);
  expect(audit.audit.find((entry) => entry.action === "grants.create")?.detail.quantity).toBe(5);

  const home = homeSchema.parse(await (await page.request.get(`${appUrl}/api/home`)).json());

  expect(home.pauseReason).toBe("suspended");

  await page.goto(`${appUrl}/`);

  await expect(page.getByText("Your account is under review.")).toBeVisible();

  await clearSinkMail(appUrl, page.request);
  await setTurnstileScenario(page.request, appUrl, { action: "magiclink" });

  const magic = await requestMagicLink(appUrl, page.request, guestEmail);

  expect(magic.status()).toBe(403);

  await page.goto(`${adminIsolatedAppUrl}/admin/users`);
  await page.getByRole("button", { name: /^Suspended 1$/u }).click();

  await expect(page.getByText(guestEmail)).toBeVisible();
});
