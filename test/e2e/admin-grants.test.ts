import { AxeBuilder } from "@axe-core/playwright";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { signInByMagicLink } from "./sign-in.ts";

import { z } from "zod";

const auditResponseSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      targetUserId: z.string().nullable(),
    }),
  ),
});

test("an admin grant reaches Home as Applications left", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  await page.goto(`${adminIsolatedAppUrl}/admin/grants`);

  await expect(page.getByRole("heading", { name: "Recent grants" })).toBeVisible();

  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByLabel("Applications", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Grant the Applications" }).click();

  await expect(page.getByText(`${authTestIdentity.ownerEmail} · granted`)).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();

  expect(axe.violations).toEqual([]);

  const auditResponse = await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`);
  const audit = auditResponseSchema.parse(await auditResponse.json());
  const grantAudit = audit.audit.find((entry) => entry.action === "grants.create");

  expect(grantAudit?.detail.quantity).toBe(5);
  expect(grantAudit?.targetUserId).not.toBe(null);

  const appUrl = adminIsolatedAppServer.url;

  await signInByMagicLink(page, appUrl, page.request, authTestIdentity.ownerEmail);
  await page.goto(`${appUrl}/home`);

  await expect(page.getByText("of 5 on your week plan")).toBeVisible();
  await expect(page.locator("aside").getByText("5", { exact: true })).toHaveText("5");
});
