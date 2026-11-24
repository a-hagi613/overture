import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./admin.fixture.ts";

test("the owner opens the admin straight through Cloudflare Access, with no passkey gate", async ({
  page,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  const token = await accessServer.issueToken({ email: authTestIdentity.ownerEmail });

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

  await page.goto(`${adminIsolatedAppUrl}/admin`);

  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent admin actions" })).toBeVisible();
  await expect(page.getByText("Assert your passkey")).toHaveCount(0);
  await expect(page.getByText("Add your passkey")).toHaveCount(0);

  await page.goto(`${adminIsolatedAppUrl}/admin/settings`);

  await expect(page.getByRole("heading", { name: "Kill switches", exact: true })).toBeVisible();

  const overview = await page.request.get(`${adminIsolatedAppUrl}/admin/api/overview`);

  expect(overview.status()).toBe(200);
});
