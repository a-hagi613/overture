import type { Page } from "@playwright/test";

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
