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
  await expect(page.getByRole("heading", { name: /Upload your resume/u })).toBeVisible();

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
  await expect(page.getByTestId("admin-users-presence")).toHaveText(
    /^\d+ online now · \d+ signed in$/u,
  );
  await expect(page.getByTestId("admin-user-online")).toHaveText("Online");

  await page.getByText(guestEmail).locator("..").click();
  await expect(page).toHaveURL(new RegExp(`${adminIsolatedAppUrl}/admin/users/`, "u"));

  const detailUrl = page.url();

  await expect(page.getByText("Read-only. Forward ATS mail here only.")).toBeVisible();
  await expect(page.getByText("Admin grant")).toBeVisible();
  await expect(page.getByText("of 300 left")).toBeVisible();
  await expect(page.getByText("Accepted by sign-in", { exact: false })).toBeVisible();

  const insight = page.getByTestId("admin-user-insight");

  await expect(insight.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(page.getByTestId("admin-user-presence")).toHaveText("Online now");
  await expect(insight.getByText("On step 2 of 4: resume and job targets")).toBeVisible();
  await expect(page.getByTestId("admin-user-queue-summary")).toHaveText("0 matched jobs, 0 scored");
  await expect(page.getByTestId("admin-user-spend-total")).toHaveText("$0.0000");
  await expect(insight.getByText("No browser sends yet.")).toBeVisible();

  const timeline = page.getByTestId("admin-user-timeline");

  await expect(timeline.getByText("Signed in", { exact: true }).first()).toBeVisible();
  await expect(timeline.getByText("300 applications granted (admin)")).toBeVisible();

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
  await page.reload();
  await expect(page.getByTestId("admin-user-timeline").getByText("users.suspend")).toBeVisible();

  const audit = auditSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`)).json(),
  );

  const suspension = audit.audit.find((entry) => entry.action === "users.suspend");

  expect(suspension?.reason).toBe(suspendReason);
  expect(suspension?.targetUserId).toBe(guest?.id);
  expect(audit.audit.some((entry) => entry.action === "invites.create")).toBe(true);
  expect(audit.audit.some((entry) => entry.action === "invites.revoke")).toBe(true);
  expect(audit.audit.find((entry) => entry.action === "grants.create")?.detail.quantity).toBe(5);

  const afterSuspension = await page.request.get(`${appUrl}/api/home`);

  expect(afterSuspension.status()).toBe(401);

  const afterState = await verifyAuthState(appUrl, page.request);

  expect(afterState.sessions.some((session) => session.userId === guest?.id)).toBe(false);

  await clearSinkMail(appUrl, page.request);
  await setTurnstileScenario(page.request, appUrl, { action: "magiclink" });

  const magic = await requestMagicLink(appUrl, page.request, guestEmail);

  expect(magic.status()).toBe(403);

  await page.goto(`${adminIsolatedAppUrl}/admin/users`);
  await page.getByRole("button", { name: /^Suspended 1$/u }).click();

  await expect(page.getByText(guestEmail)).toBeVisible();
});

test("the owner opens every outside dashboard from the admin Dashboards page", async ({
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await page.getByRole("link", { name: "Dashboards" }).first().click();

  await expect(page).toHaveURL(new RegExp(`${adminIsolatedAppUrl}/admin/dashboards`, "u"));
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await expect(page.getByTestId("admin-dashboards-presence")).toHaveText(
    /^\d+ online now · \d+ signed in$/u,
  );

  const outside = ["stripe", "browser_use", "anthropic"].map((id) =>
    page.getByTestId(`admin-dashboard-${id}`),
  );

  await Promise.all(
    outside.flatMap((link) => [
      expect(link).toBeVisible(),
      expect(link).toHaveAttribute("target", "_blank"),
      expect(link).toHaveAttribute("rel", "noopener noreferrer"),
    ]),
  );

  await expect(page.getByTestId("admin-dashboard-stripe")).toHaveAttribute(
    "href",
    "https://dashboard.stripe.com/test/payments",
  );

  await page.locator("main").getByRole("link", { name: "LLM spend" }).click();
  await expect(page).toHaveURL(new RegExp(`${adminIsolatedAppUrl}/admin/llm`, "u"));
  await page.goBack();

  await page.setViewportSize({ height: 844, width: 390 });
  await expectAxeClean(page, "390px dashboards");

  await page.setViewportSize({ height: 900, width: 1280 });
  await expectAxeClean(page, "1280px dashboards");
});
