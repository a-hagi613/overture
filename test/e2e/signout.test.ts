import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { signInByMagicLink, verifyAuthState } from "./sign-in.ts";

test("the owner signs out of this device from Settings and cannot return to the app", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const appServerUrl = isolatedAppServer.url;

  await signInByMagicLink(page, appServerUrl, request, authTestIdentity.ownerEmail);
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();
  expect((await verifyAuthState(appServerUrl, request)).sessions).toHaveLength(1);

  await page.goto(`${appServerUrl}/profile/account`);

  const signOutHere = page.getByRole("button", { exact: true, name: "Sign out" });

  await expect(signOutHere).toBeVisible();

  const signedOut = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/sign-out") && response.ok(),
  );

  await signOutHere.click();
  await signedOut;

  await expect(page).toHaveURL(/\/signin$/u);
  expect((await verifyAuthState(appServerUrl, request)).sessions).toHaveLength(0);

  await page.goto(`${appServerUrl}/`);
  await expect(page).toHaveURL(`${appServerUrl}/`);
  await expect(
    page.getByRole("heading", { level: 1, name: /The job hunt, handled\./u }),
  ).toBeVisible();

  await page.goto(`${appServerUrl}/board`);
  await expect(page).toHaveURL(/\/signin$/u);
});

test("the sign-out control is separate from signing out every device", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  await signInByMagicLink(page, isolatedAppServer.url, request, authTestIdentity.ownerEmail);
  await page.goto(`${isolatedAppServer.url}/profile/account`);

  await expect(page.getByRole("button", { exact: true, name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
  await expect(page.getByText("Sign out of this device")).toBeVisible();
});
