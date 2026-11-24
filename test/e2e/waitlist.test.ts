import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { latestMailLink } from "./sign-in.ts";

const widthAndTheme = [
  { theme: "light", width: 390 },
  { theme: "dark", width: 390 },
  { theme: "light", width: 1280 },
  { theme: "dark", width: 1280 },
] as const;

const screenshotDirectory = process.env.WAITLIST_SCREENSHOTS;

const inviteSubject = "Your Overture invite is ready";

const mailSchema = z.object({
  messages: z.array(z.object({ body: z.string(), subject: z.string(), to: z.string() })),
});

const waitlistStateSchema = z.object({
  entries: z.array(
    z.object({
      email: z.string(),
      invitedAt: z.number().nullable(),
      status: z.enum(["pending", "invited", "joined"]),
    }),
  ),
});

async function waitlistRows(request: APIRequestContext, baseUrl: string, email: string) {
  const response = await request.get(
    `${baseUrl}/__test__/waitlist?email=${encodeURIComponent(email)}`,
  );

  return waitlistStateSchema.parse(await response.json()).entries;
}

async function inviteMailBody(request: APIRequestContext, baseUrl: string, email: string) {
  const response = await request.get(`${baseUrl}/__test__/mail`);
  const { messages } = mailSchema.parse(await response.json());
  const message = messages.findLast((sent) => sent.to === email && sent.subject === inviteSubject);

  if (message === undefined) {
    throw new Error(`No invite mail addressed to ${email}.`);
  }

  return message.body;
}

function linkIn(body: string) {
  const link = /https?:\/\/[^\s]+/u.exec(body)?.[0];

  if (link === undefined) {
    throw new Error("No link in the invite mail.");
  }

  return link;
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(0);
}

async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${label} axe violations`).toEqual([]);
}

async function capture(page: Page, name: string) {
  if (screenshotDirectory === undefined) {
    return;
  }

  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ fullPage: true, path: join(screenshotDirectory, `${name}.png`) });
}

test("a stranger joins the waitlist with no bot check, and a repeat submission is idempotent", async ({
  page,
  appServerUrl,
  appServer,
}) => {
  const email = "waiting@example.com";

  await page.goto(`${appServerUrl}/signup`);

  await expect(page.getByRole("heading", { name: "Join the waitlist" })).toBeVisible();
  await expect(page.locator("[data-turnstile]")).toHaveCount(0);
  await expect(page.locator("iframe[src*='challenges.cloudflare.com']")).toHaveCount(0);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Role you want").fill("Product designer");
  await page.getByLabel("Where you are based").fill("Montreal");
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeVisible();
  await expect(page.getByText(`We'll write to ${email} when your invite is ready.`)).toBeVisible();

  const [stored] = await waitlistRows(page.request, appServer.url, email);

  expect(stored).toMatchObject({ email, status: "pending" });

  const duplicate = await page.request.post(`${appServer.url}/api/waitlist`, {
    data: { email: "WAITING@example.com", targetLocation: "Lisbon", targetRole: "Engineer" },
    headers: { origin: appServerUrl },
  });

  expect(duplicate.status()).toBe(200);
  expect(z.object({ message: z.string() }).parse(await duplicate.json()).message).toContain(
    "You're on the list",
  );

  const rows = await waitlistRows(page.request, appServer.url, email);

  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("pending");

  const honeypot = await page.request.post(`${appServer.url}/api/waitlist`, {
    data: { company_url: "https://spam.example", email: "bot@example.com" },
    headers: { origin: appServerUrl },
  });

  expect(honeypot.status()).toBe(200);
  expect(z.object({ ok: z.literal(true) }).parse(await honeypot.json()).ok).toBe(true);
  expect(await waitlistRows(page.request, appServer.url, "bot@example.com")).toHaveLength(0);
});

test.describe("the public waitlist holds its layout and passes axe", () => {
  for (const { theme, width } of widthAndTheme) {
    test(`at ${String(width)}px, ${theme}`, async ({ browser, appServerUrl }) => {
      const context = await browser.newContext({ viewport: { height: 900, width } });

      try {
        const page = await context.newPage();

        await page.addInitScript((stored) => {
          globalThis.localStorage.setItem("overture.theme", stored);
        }, theme);
        await page.goto(`${appServerUrl}/signup`);
        await expect(page.getByRole("heading", { name: "Join the waitlist" })).toBeVisible();

        const label = `waitlist form at ${String(width)} ${theme}`;

        await expectNoOverflow(page, label);
        await expectNoAxeViolations(page, label);
        await capture(page, `waitlist-form-${String(width)}-${theme}`);
      } finally {
        await context.close();
      }
    });
  }
});

test("an admin approves a waitlist entry in one click and the invited email joins", async ({
  browser,
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const email = "approved@example.com";

  const seeded = await page.request.post(`${adminIsolatedAppServer.url}/__test__/waitlist`, {
    data: { email, targetLocation: "Montreal", targetRole: "Designer" },
  });

  expect(seeded.ok()).toBe(true);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await page.goto(`${adminIsolatedAppUrl}/admin/waitlist`);

  const row = page.locator(`[data-waitlist-row="${email}"]`);

  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve & Send Invite" }).click();
  await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible();
  await expect(row.getByText("Invited", { exact: true })).toBeVisible();

  expect((await waitlistRows(page.request, adminIsolatedAppServer.url, email))[0]?.status).toBe(
    "invited",
  );

  const inviteLink = linkIn(await inviteMailBody(page.request, adminIsolatedAppServer.url, email));

  expect(inviteLink).toBe(`${adminIsolatedAppUrl}/signin`);

  const inviteMails = mailSchema.parse(
    await (await page.request.get(`${adminIsolatedAppServer.url}/__test__/mail`)).json(),
  );

  expect(inviteMails.messages.filter((mail) => mail.subject === inviteSubject)).toHaveLength(1);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();

  try {
    await guest.goto(inviteLink);
    await guest.getByLabel("Email").fill(email);
    await guest.getByRole("button", { name: "Send sign-in link" }).click();
    await guest.getByText("Link sent to").waitFor();

    const magicLink = await latestMailLink(adminIsolatedAppUrl, guest.request, email);

    await guest.goto(magicLink);

    await expect
      .poll(
        async () =>
          (await waitlistRows(page.request, adminIsolatedAppServer.url, email))[0]?.status,
      )
      .toBe("joined");
  } finally {
    await guestContext.close();
  }
});

test("the admin waitlist holds its layout and passes axe at 390 and 1280, light and dark", async ({
  page,
  adminAppUrl,
  adminAppServer,
  accessServer,
}) => {
  test.setTimeout(240_000);

  const email = "queued@example.com";

  await page.request.post(`${adminAppServer.url}/__test__/waitlist`, {
    data: { email, targetLocation: "Berlin", targetRole: "Engineer" },
  });
  await openAdminAsOwner(page, adminAppUrl, accessServer.issueToken);

  async function checkAt(index: number) {
    if (index >= widthAndTheme.length) {
      return;
    }

    const combo = widthAndTheme[index];

    if (combo === undefined) {
      return;
    }

    await page.setViewportSize({ height: 900, width: combo.width });
    await page.goto(`${adminAppUrl}/admin/waitlist`);
    await page.evaluate((stored) => {
      globalThis.localStorage.setItem("overture.theme", stored);
    }, combo.theme);
    await page.reload();

    await expect(page.getByRole("heading", { level: 1, name: "Waitlist" })).toBeVisible();
    await expect(page.locator(`[data-waitlist-row="${email}"]`)).toBeVisible();

    const label = `admin waitlist at ${String(combo.width)} ${combo.theme}`;

    await expectNoOverflow(page, label);
    await expectNoAxeViolations(page, label);
    await capture(page, `waitlist-admin-${String(combo.width)}-${combo.theme}`);

    await checkAt(index + 1);
  }

  await checkAt(0);
});
