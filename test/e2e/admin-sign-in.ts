import type { Page } from "@playwright/test";

import { expect } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";

/**
 * Opens the admin host the way Cloudflare Access does in production: the
 * owner's Access cookie is the only credential. No magic link or passkey step.
 * @param page The page to drive.
 * @param adminAppUrl The admin host base URL.
 * @param issueToken Issues a Cloudflare Access JWT for the given claims.
 */
export async function openAdminAsOwner(
  page: Page,
  adminAppUrl: string,
  issueToken: (claims: { email: string }) => Promise<string>,
) {
  const token = await issueToken({ email: authTestIdentity.ownerEmail });

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

  await page.goto(`${adminAppUrl}/admin/settings`);

  await expect(page.getByRole("heading", { name: "Kill switches", exact: true })).toBeVisible();
}
