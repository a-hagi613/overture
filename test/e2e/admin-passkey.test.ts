import { enableVirtualAuthenticator, signInOwnerOnAdmin } from "./admin-sign-in.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./admin.fixture.ts";

const PASSKEY_WINDOW_MS = 13 * 60 * 60 * 1000;

test("the owner opens the admin after registering and asserting a passkey, and the passkey gate closes again after 12 hours", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  await enableVirtualAuthenticator(page);
  await signInOwnerOnAdmin(page, adminIsolatedAppUrl);

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
  await expect(page.getByRole("heading", { name: "Assert your passkey" })).toBeVisible();

  await page.getByRole("button", { name: "Add your passkey" }).click();

  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent admin actions" })).toBeVisible();

  await page.goto(`${adminIsolatedAppUrl}/admin/settings`);

  await expect(page.getByRole("heading", { name: "Kill switches", exact: true })).toBeVisible();

  await page.request.post(`${adminIsolatedAppServer.url}/__test__/clock/offset`, {
    data: { offsetMs: PASSKEY_WINDOW_MS },
  });

  await page.goto(`${adminIsolatedAppUrl}/admin`);
  await expect(page.getByRole("heading", { name: "Assert your passkey" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assert your passkey" })).toBeVisible();

  await page.request.post(`${adminIsolatedAppServer.url}/__test__/clock/offset`, {
    data: { offsetMs: 0 },
  });
});
