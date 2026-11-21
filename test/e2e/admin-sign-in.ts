import type { Page } from "@playwright/test";

import { expect } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink } from "./sign-in.ts";

export async function enableVirtualAuthenticator(page: Page) {
  const session = await page.context().newCDPSession(page);

  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return session;
}

export async function signInOwnerOnAdmin(page: Page, adminAppUrl: string) {
  await page.goto(`${adminAppUrl}/signin`);
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("Link sent to").waitFor();

  const link = await latestMailLink(adminAppUrl, page.request, authTestIdentity.ownerEmail);

  await page.goto(link);
}

export async function openAdminAsOwner(
  page: Page,
  adminAppUrl: string,
  issueToken: (claims: { email: string }) => Promise<string>,
) {
  await enableVirtualAuthenticator(page);
  await signInOwnerOnAdmin(page, adminAppUrl);

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
