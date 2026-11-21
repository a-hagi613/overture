import type { Browser, Page } from "@playwright/test";

import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import {
  verifyAuthState,
  requestMagicLink,
  setTurnstileScenario,
  signInByMagicLink,
  clearSinkMail,
  latestMailLink,
  signInWithPassword,
  sinkMailCount,
} from "./sign-in.ts";

const inviteSchema = z.object({
  acceptedAt: z.number().nullable(),
  acceptedUserId: z.string().nullable(),
  createdAt: z.number(),
  email: z.string().nullable(),
  grantId: z.string().nullable(),
  id: z.string(),
  invitedBy: z.string().nullable(),
  revokedAt: z.number().nullable(),
  status: z.enum(["accepted", "pending", "revoked"]),
});

const inviteListSchema = z.object({ invites: z.array(inviteSchema) });

const inviteResponseSchema = z.object({ invite: inviteSchema });

const grantListSchema = z.object({
  grants: z.array(
    z.object({
      createdAt: z.number(),
      email: z.string(),
      expiresAt: z.number().nullable(),
      id: z.string(),
      quantity: z.number(),
      source: z.string(),
      startsAt: z.number(),
    }),
  ),
});

function guestPersona(sub: string, email: string) {
  return { sub, name: "Guest Person", email, emailVerified: true, picture: null };
}

async function createInvite(adminPage: Page, adminUrl: string, email: string) {
  const response = await adminPage.request.post(`${adminUrl}/admin/api/invites`, {
    data: { email },
  });

  expect(response.status()).toBe(201);

  return inviteResponseSchema.parse(await response.json()).invite;
}

async function listInvites(adminPage: Page, adminUrl: string) {
  const response = await adminPage.request.get(`${adminUrl}/admin/api/invites`);

  expect(response.ok()).toBe(true);

  return inviteListSchema.parse(await response.json()).invites;
}

async function listGrants(adminPage: Page, adminUrl: string) {
  const response = await adminPage.request.get(`${adminUrl}/admin/api/grants`);

  expect(response.ok()).toBe(true);

  return grantListSchema.parse(await response.json()).grants;
}

async function openAdmin(
  browser: Browser,
  adminUrl: string,
  issueToken: (claims: { email: string }) => Promise<string>,
) {
  const context = await browser.newContext();
  const page = await context.newPage();

  await openAdminAsOwner(page, adminUrl, issueToken);

  return { context, page };
}

test("an invited email joins by magic link, gets one grant of 300, and cannot be revoked after", async ({
  browser,
  page,
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
}) => {
  const appUrl = adminIsolatedAppServer.url;
  const guestEmail = "guest.magic@example.com";
  const admin = await openAdmin(browser, adminIsolatedAppUrl, accessServer.issueToken);

  const created = await createInvite(admin.page, adminIsolatedAppUrl, guestEmail);

  expect(created.email).toBe(guestEmail);
  expect(created.status).toBe("pending");
  expect(created.grantId).toBeNull();

  const listed = await listInvites(admin.page, adminIsolatedAppUrl);

  expect(listed.map((invite) => invite.email)).toContain(guestEmail);
  expect(
    (await listGrants(admin.page, adminIsolatedAppUrl)).map((grant) => grant.email),
  ).not.toContain(guestEmail);

  await signInByMagicLink(page, appUrl, page.request, guestEmail);
  await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();
  await page.goto(`${appUrl}/`);
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();
  await expect(page.getByText("of 300 on your week plan")).toBeVisible();

  const state = await verifyAuthState(appUrl, page.request);
  const guest = state.users.find((user) => user.email === guestEmail);

  expect(guest?.role).toBe("user");

  const accepted = (await listInvites(admin.page, adminIsolatedAppUrl)).find(
    (invite) => invite.id === created.id,
  );

  expect(accepted?.status).toBe("accepted");
  expect(accepted?.acceptedUserId).toBe(guest?.id);
  expect(accepted?.grantId).not.toBeNull();

  const grants = (await listGrants(admin.page, adminIsolatedAppUrl)).filter(
    (grant) => grant.email === guestEmail,
  );

  expect(grants).toHaveLength(1);
  expect(grants[0]?.quantity).toBe(300);
  expect(grants[0]?.source).toBe("admin");

  await signInByMagicLink(page, appUrl, page.request, guestEmail);
  await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();
  await page.goto(`${appUrl}/`);
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();
  await expect(page.getByText("of 300 on your week plan")).toBeVisible();

  expect(
    (await listGrants(admin.page, adminIsolatedAppUrl)).filter(
      (grant) => grant.email === guestEmail,
    ),
  ).toHaveLength(1);

  const revoked = await admin.page.request.post(
    `${adminIsolatedAppUrl}/admin/api/invites/${created.id}/revoke`,
  );

  expect(revoked.status()).toBe(409);

  await admin.context.close();
});

test("an invite is accepted by Google and by LinkedIn, each granting 300 once", async ({
  browser,
  page,
  request,
  identityServer,
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
}) => {
  const appUrl = adminIsolatedAppServer.url;
  const googleEmail = "guest.google@example.com";
  const linkedInEmail = "guest.linkedin@example.com";
  const admin = await openAdmin(browser, adminIsolatedAppUrl, accessServer.issueToken);

  await createInvite(admin.page, adminIsolatedAppUrl, googleEmail);
  await createInvite(admin.page, adminIsolatedAppUrl, linkedInEmail);

  await setTurnstileScenario(request, appUrl, { action: "signin" });
  await identityServer.setPersona(guestPersona("google-guest", googleEmail));
  await page.goto(`${appUrl}/signin`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();
  await page.goto(`${appUrl}/`);
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();
  await expect(page.getByText("of 300 on your week plan")).toBeVisible();

  const linkedInContext = await browser.newContext();
  const linkedInPage = await linkedInContext.newPage();

  await setTurnstileScenario(linkedInPage.request, appUrl, { action: "signin" });
  await identityServer.setPersona(guestPersona("linkedin-guest", linkedInEmail));
  await linkedInPage.goto(`${appUrl}/signin`);
  await linkedInPage.getByRole("button", { name: "Continue with LinkedIn" }).click();
  await expect(linkedInPage.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();
  await linkedInPage.goto(`${appUrl}/`);
  await expect(linkedInPage.getByRole("heading", { name: "The day so far" })).toBeVisible();
  await expect(linkedInPage.getByText("of 300 on your week plan")).toBeVisible();

  await linkedInContext.close();

  const state = await verifyAuthState(appUrl, page.request);

  expect(state.users.find((user) => user.email === googleEmail)?.role).toBe("user");
  expect(state.users.find((user) => user.email === linkedInEmail)?.role).toBe("user");

  const invites = await listInvites(admin.page, adminIsolatedAppUrl);

  expect(invites.find((invite) => invite.email === googleEmail)?.status).toBe("accepted");
  expect(invites.find((invite) => invite.email === linkedInEmail)?.status).toBe("accepted");

  const grants = await listGrants(admin.page, adminIsolatedAppUrl);

  expect(grants.filter((grant) => grant.email === googleEmail)).toHaveLength(1);
  expect(grants.filter((grant) => grant.email === linkedInEmail)).toHaveLength(1);

  await admin.context.close();
});

test("a revoked or uninvited email is refused the same way by every method", async ({
  browser,
  page,
  request,
  identityServer,
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
}) => {
  const appUrl = adminIsolatedAppServer.url;
  const revokedEmail = "guest.revoked@example.com";
  const strangerEmail = "guest.stranger@example.com";
  const admin = await openAdmin(browser, adminIsolatedAppUrl, accessServer.issueToken);
  const created = await createInvite(admin.page, adminIsolatedAppUrl, revokedEmail);

  const revoked = await admin.page.request.post(
    `${adminIsolatedAppUrl}/admin/api/invites/${created.id}/revoke`,
  );

  expect(revoked.status()).toBe(200);
  expect(inviteResponseSchema.parse(await revoked.json()).invite.status).toBe("revoked");

  await clearSinkMail(appUrl, request);
  await setTurnstileScenario(request, appUrl, { action: "magiclink" });

  const revokedMagic = await requestMagicLink(appUrl, page.request, revokedEmail);
  const strangerMagic = await requestMagicLink(appUrl, page.request, strangerEmail);

  expect(revokedMagic.status()).toBe(403);
  expect(strangerMagic.status()).toBe(403);
  expect(await sinkMailCount(appUrl, request)).toBe(0);

  await setTurnstileScenario(request, appUrl, { action: "signin" });
  await identityServer.setPersona(guestPersona("revoked-google", revokedEmail));
  await page.goto(`${appUrl}/signin`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("This email isn't invited yet.")).toBeVisible();

  await identityServer.setPersona(guestPersona("revoked-linkedin", revokedEmail));
  await page.goto(`${appUrl}/signin`);
  await page.getByRole("button", { name: "Continue with LinkedIn" }).click();
  await expect(page.getByText("This email isn't invited yet.")).toBeVisible();

  const state = await verifyAuthState(appUrl, request);

  expect(state.users.map((user) => user.email)).not.toContain(revokedEmail);

  await admin.context.close();
});

test("a suspended user cannot sign in", async ({
  browser,
  page,
  request,
  identityServer,
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
}) => {
  const appUrl = adminIsolatedAppServer.url;
  const suspendedEmail = "guest.suspended@example.com";
  const admin = await openAdmin(browser, adminIsolatedAppUrl, accessServer.issueToken);

  await createInvite(admin.page, adminIsolatedAppUrl, suspendedEmail);
  await setTurnstileScenario(request, appUrl, { action: "signin" });
  await identityServer.setPersona(guestPersona("suspended-google", suspendedEmail));
  await page.goto(`${appUrl}/signin`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Overture/u })).toBeVisible();

  const signedIn = await verifyAuthState(appUrl, request);
  const guest = signedIn.users.find((user) => user.email === suspendedEmail);

  expect(guest).toBeDefined();

  await request.post(`${appUrl}/__test__/user/suspend`, {
    data: { suspended: true, userId: guest?.id },
  });

  await clearSinkMail(appUrl, request);
  await setTurnstileScenario(request, appUrl, { action: "magiclink" });

  const magic = await requestMagicLink(appUrl, page.request, suspendedEmail);

  expect(magic.status()).toBe(403);
  expect(await sinkMailCount(appUrl, request)).toBe(0);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();

  await setTurnstileScenario(secondPage.request, appUrl, { action: "signin" });
  await identityServer.setPersona(guestPersona("suspended-google", suspendedEmail));
  await secondPage.goto(`${appUrl}/signin`);
  await secondPage.getByRole("button", { name: "Continue with Google" }).click();
  await expect(secondPage.getByText("This account is suspended.")).toBeVisible();

  const after = await verifyAuthState(appUrl, secondPage.request);

  expect(after.sessions.filter((session) => session.userId === guest?.id)).toHaveLength(
    signedIn.sessions.filter((session) => session.userId === guest?.id).length,
  );

  await secondContext.close();
  await admin.context.close();
});

test("an invite is accepted on the first verified password sign-in and grants 300 once", async ({
  browser,
  page,
  request,
  accessServer,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
}) => {
  const appUrl = adminIsolatedAppServer.url;
  const guestEmail = "guest.password@example.com";
  const password = "overture-pass-813";
  const admin = await openAdmin(browser, adminIsolatedAppUrl, accessServer.issueToken);

  await createInvite(admin.page, adminIsolatedAppUrl, guestEmail);
  await clearSinkMail(appUrl, request);
  await setTurnstileScenario(page.request, appUrl, { action: "signup" });

  await page.goto(`${appUrl}/signin`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(guestEmail);
  await page.getByLabel("Create a password").fill(password);
  await expect
    .poll(
      async () =>
        await page
          .locator('[data-turnstile="password"] input[name="cf-turnstile-response"]')
          .inputValue(),
    )
    .not.toBe("");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const beforeVerification = await verifyAuthState(appUrl, page.request);
  const pending = beforeVerification.users.find((user) => user.email === guestEmail);

  expect(pending?.emailVerified).toBe(false);
  expect(beforeVerification.sessions.filter((session) => session.userId === pending?.id)).toEqual(
    [],
  );

  const link = await latestMailLink(appUrl, page.request, guestEmail);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();

  const state = await verifyAuthState(appUrl, page.request);
  const guest = state.users.find((user) => user.email === guestEmail);

  expect(guest?.role).toBe("user");
  expect(guest?.emailVerified).toBe(true);

  const invites = await listInvites(admin.page, adminIsolatedAppUrl);
  const acceptedInvite = invites.find((invite) => invite.email === guestEmail);

  expect(acceptedInvite?.status).toBe("accepted");
  expect(acceptedInvite?.acceptedUserId).toBe(guest?.id);

  expect(
    (await listGrants(admin.page, adminIsolatedAppUrl)).filter(
      (grant) => grant.email === guestEmail,
    ),
  ).toHaveLength(1);

  const second = await browser.newContext();
  const secondPage = await second.newPage();

  await setTurnstileScenario(secondPage.request, appUrl, { action: "signin" });

  const signedIn = await signInWithPassword(appUrl, secondPage.request, {
    email: guestEmail,
    password,
  });

  expect(signedIn.ok()).toBe(true);
  await second.close();

  await admin.context.close();
});
