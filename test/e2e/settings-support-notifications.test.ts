import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { Page } from "@playwright/test";

import { expect, test } from "./admin.fixture.ts";
import { openAdminAsOwner } from "./admin-sign-in.ts";
import { signInByMagicLink, verifyAuthState } from "./sign-in.ts";

const guest = "guest.settings.log@example.com";
const revealReason = "Checking a stuck application with the person";

const stateSchema = z.object({ users: z.array(z.object({ email: z.string(), id: z.string() })) });

const notificationsSchema = z.object({
  notifications: z.array(z.object({ kind: z.string(), title: z.string() })),
});

const preferencesSchema = z.object({
  preferences: z.record(z.string(), z.boolean()),
});

const emitSchema = z.object({ id: z.string().nullable() });

const revealResponseSchema = z.object({
  reveal: z.object({ reason: z.string(), targetUserId: z.string() }).nullable(),
});

async function captureSettings(
  page: Page,
  appUrl: string,
  captureDir: string,
  width: number,
  scheme: "light" | "dark",
) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`${appUrl}/settings`);
  await page.evaluate((theme) => {
    globalThis.localStorage.setItem("overture.theme", theme);
  }, scheme);
  await page.goto(`${appUrl}/settings`);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: join(captureDir, `settings-${String(width)}-${scheme}.png`),
  });
  await page.goto(`${appUrl}/settings/support-access`);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: join(captureDir, `support-access-${String(width)}-${scheme}.png`),
  });
}

test("a Reveal shows in the user's Support access log with its reason, and a switched-off kind stops its notice", async ({
  page,
  accessServer,
  revealAppServer,
  revealAppUrl,
}) => {
  test.setTimeout(180_000);

  const appUrl = revealAppServer.url;
  const adminBase = `${revealAppUrl}/admin/api`;

  await openAdminAsOwner(page, revealAppUrl, accessServer.issueToken);

  const invite = await page.request.post(`${adminBase}/invites`, { data: { email: guest } });

  expect(invite.status()).toBe(201);

  await signInByMagicLink(page, appUrl, page.request, guest);

  const state = stateSchema.parse(await verifyAuthState(appUrl, page.request));
  const user = state.users.find((candidate) => candidate.email === guest);

  if (user === undefined) {
    throw new Error("the guest was not created");
  }

  const opened = await page.request.post(`${adminBase}/users/${user.id}/reveal`, {
    data: { reason: revealReason },
  });

  expect(opened.status()).toBe(201);
  expect(revealResponseSchema.parse(await opened.json()).reveal?.targetUserId).toBe(user.id);

  await page.goto(`${appUrl}/settings/support-access`);

  const list = page.getByTestId("support-access-list");

  await expect(list).toBeVisible();
  await expect(list.locator("li[data-action='reveal.open']")).toHaveCount(1);
  await expect(list).toContainText(revealReason);
  await expect(list).toContainText("Opened your account");

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);

  await page.goto(`${appUrl}/settings`);

  const replySwitch = page.getByRole("switch", { name: "An employer reply", exact: true });

  await expect(replySwitch).toHaveAttribute("aria-checked", "true");
  await replySwitch.click();
  await expect(replySwitch).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await expect(
    page.getByRole("switch", { name: "An employer reply", exact: true }),
  ).toHaveAttribute("aria-checked", "false");

  const saved = preferencesSchema.parse(
    await (await page.request.get(`${appUrl}/api/notifications/preferences`)).json(),
  );

  expect(saved.preferences.reply).toBe(false);

  const includeSwitch = page.getByRole("switch", { name: "Include yesterday", exact: true });

  await expect(includeSwitch).toHaveAttribute("aria-checked", "true");
  await includeSwitch.click();
  await expect(includeSwitch).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Include yesterday", exact: true }),
  ).toHaveAttribute("aria-checked", "false");

  const savedInclude = preferencesSchema.parse(
    await (await page.request.get(`${appUrl}/api/notifications/preferences`)).json(),
  );

  expect(savedInclude.preferences.recap_include_yesterday).toBe(false);

  const emitOff = emitSchema.parse(
    await (
      await page.request.post(`${appUrl}/__test__/notifications/emit`, {
        data: {
          email: guest,
          kind: "reply",
          title: "Employer reply: suppressed",
          body: "An employer wrote back.",
          url: "/inbox",
        },
      })
    ).json(),
  );

  expect(emitOff.id).toBeNull();

  const listedOff = notificationsSchema.parse(
    await (await page.request.get(`${appUrl}/api/notifications`)).json(),
  );

  expect(listedOff.notifications.some((row) => row.title === "Employer reply: suppressed")).toBe(
    false,
  );

  await page.goto(`${appUrl}/settings`);
  const replyAgain = page.getByRole("switch", { name: "An employer reply", exact: true });

  await replyAgain.click();
  await expect(replyAgain).toHaveAttribute("aria-checked", "true");

  const emitOn = emitSchema.parse(
    await (
      await page.request.post(`${appUrl}/__test__/notifications/emit`, {
        data: {
          email: guest,
          kind: "reply",
          title: "Employer reply: delivered",
          body: "An employer wrote back.",
          url: "/inbox",
        },
      })
    ).json(),
  );

  expect(emitOn.id).not.toBeNull();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const anonymous = await apiRequest.newContext();
  const unauthenticated = await anonymous.get(`${appUrl}/api/support-access`);

  expect(unauthenticated.status()).toBe(401);

  const captureDir = process.env.SETTINGS_CAPTURE_DIR;

  if (captureDir !== undefined) {
    await captureSettings(page, appUrl, captureDir, 390, "light");
    await captureSettings(page, appUrl, captureDir, 390, "dark");
    await captureSettings(page, appUrl, captureDir, 1280, "light");
    await captureSettings(page, appUrl, captureDir, 1280, "dark");
  }
});
