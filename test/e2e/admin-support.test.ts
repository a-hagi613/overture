import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";

import type { Page } from "@playwright/test";

const supportTicketSchema = z.object({
  adminNotes: z.string().nullable(),
  id: z.string(),
  message: z.string().nullable(),
  referenceId: z.string(),
  status: z.string(),
  subject: z.string(),
  userEmail: z.string(),
});

const supportListSchema = z.object({
  items: z.array(supportTicketSchema),
  now: z.number(),
  openCount: z.number(),
  total: z.number(),
});

const mailSchema = z.object({
  messages: z.array(
    z.object({
      body: z.string(),
      subject: z.string(),
      to: z.string(),
    }),
  ),
});

const auditSchema = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const overviewSchema = z.object({ openSupportTickets: z.number() });

const widths = [390, 1280] as const;

const themes = ["light", "dark"] as const;

async function seedTicket(appUrl: string) {
  const { owner, userId } = await ownerContextFor(appUrl);

  const response = await owner.post("/api/support", {
    data: {
      category: "billing",
      message: "I was charged twice for the same week. Please check it.",
      subject: "Charged twice",
    },
  });

  expect(response.status()).toBe(201);

  const { referenceId } = z.object({ referenceId: z.string() }).parse(await response.json());

  return { owner, referenceId, userId };
}

async function ticketsAt(page: Page, adminUrl: string, status: string) {
  const response = await page.request.get(
    `${adminUrl}/admin/api/support?status=${encodeURIComponent(status)}&limit=100`,
  );

  expect(response.status()).toBe(200);

  return supportListSchema.parse(await response.json());
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(overflow.scroll, `horizontal overflow at ${label}`).toBeLessThanOrEqual(overflow.client);
}

test("the owner triages a support ticket from the queue", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const { owner, referenceId } = await seedTicket(adminIsolatedAppServer.url);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);
  await page.goto(`${adminIsolatedAppUrl}/admin/support`);

  await expect(page.getByRole("heading", { name: "Support queue" })).toBeVisible();
  await expect(page.getByText("Charged twice").first()).toBeVisible();

  await page
    .getByRole("button", { name: /Charged twice/u })
    .first()
    .click();

  await expect(page.getByRole("heading", { name: "Charged twice" })).toBeVisible();
  await expect(page.getByText("I was charged twice for the same week.")).toBeVisible();
  await expect(page.getByText(`Reference ${referenceId}`)).toBeVisible();

  await page.getByLabel("Internal note").fill("Refunded the duplicate charge.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("The ticket was updated.")).toBeVisible();

  await page.getByRole("button", { name: "Mark in progress" }).click();
  await expect(page.getByText("Currently in progress.")).toBeVisible();

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByText("Currently resolved.")).toBeVisible();

  await page.getByLabel("Reply").fill("We refunded the duplicate charge. Sorry about that.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("The reply was sent.")).toBeVisible();

  const resolved = await ticketsAt(page, adminIsolatedAppUrl, "resolved");

  expect(resolved.items).toHaveLength(1);
  expect(resolved.items[0]?.referenceId).toBe(referenceId);
  expect(resolved.items[0]?.adminNotes).toBe("Refunded the duplicate charge.");
  expect(resolved.openCount).toBe(0);

  const mail = mailSchema.parse(
    await (await page.request.get(`${adminIsolatedAppServer.url}/__test__/mail`)).json(),
  );

  const reply = mail.messages.find((message) => message.subject.startsWith("[Ref: "));

  expect(reply?.to).toBe(authTestIdentity.ownerEmail);
  expect(reply?.subject).toBe(`[Ref: ${referenceId}] Re: Charged twice`);
  expect(reply?.body).toContain("We refunded the duplicate charge.");

  const updates = auditSchema.parse(
    await (
      await page.request.get(
        `${adminIsolatedAppUrl}/admin/api/audit?action=support.update&limit=20`,
      )
    ).json(),
  );

  expect(updates.entries.length).toBeGreaterThanOrEqual(3);
  expect(updates.entries.every((entry) => entry.action === "support.update")).toBe(true);

  const replies = auditSchema.parse(
    await (
      await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit?action=support.reply&limit=20`)
    ).json(),
  );

  expect(replies.entries).toHaveLength(1);

  const overview = overviewSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/overview`)).json(),
  );

  expect(overview.openSupportTickets).toBe(0);

  await owner.dispose();
});

test("the queue filters by status and the overview badge counts open tickets", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const { owner } = await seedTicket(adminIsolatedAppServer.url);

  const second = await owner.post("/api/support", {
    data: {
      category: "bug",
      message: "The calendar event disappeared after I saved it.",
      subject: "Calendar event lost",
    },
  });

  expect(second.status()).toBe(201);

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const all = await ticketsAt(page, adminIsolatedAppUrl, "all");
  const billing = all.items.find((ticket) => ticket.subject === "Charged twice");
  const calendar = all.items.find((ticket) => ticket.subject === "Calendar event lost");

  expect(all.openCount).toBe(2);
  expect(billing).toBeDefined();
  expect(calendar).toBeDefined();

  const moved = await page.request.patch(
    `${adminIsolatedAppUrl}/admin/api/support/${encodeURIComponent(calendar?.id ?? "")}`,
    { data: { status: "in_progress" } },
  );

  expect(moved.status()).toBe(200);

  await page.goto(`${adminIsolatedAppUrl}/admin/support?status=all`);

  await expect(page.getByRole("heading", { name: "Support queue" })).toBeVisible();

  await page.getByRole("button", { name: "In progress", exact: true }).click();
  await expect(page.getByText("Calendar event lost").first()).toBeVisible();
  await expect(page.getByText("Charged twice")).toHaveCount(0);

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText("Charged twice").first()).toBeVisible();
  await expect(page.getByText("Calendar event lost")).toHaveCount(0);

  await page.goto(`${adminIsolatedAppUrl}/admin`);

  const badge = page.getByRole("link", { name: "1 open support ticket · open the Support queue" });

  await expect(badge).toBeVisible();
  await badge.click();
  await expect(page).toHaveURL(/\/admin\/support\?status=open/u);
  await expect(page.getByRole("heading", { name: "Support queue" })).toBeVisible();

  await owner.dispose();
});

for (const width of widths) {
  for (const theme of themes) {
    test(`the support queue is overflow-free and axe clean at ${String(width)}px ${theme}`, async ({
      page,
      adminIsolatedAppUrl,
      adminIsolatedAppServer,
      accessServer,
    }) => {
      test.setTimeout(120_000);

      const label = `${String(width)}px ${theme}`;
      const { owner } = await seedTicket(adminIsolatedAppServer.url);

      await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

      const all = await ticketsAt(page, adminIsolatedAppUrl, "all");
      const [ticket] = all.items;

      expect(ticket).toBeDefined();

      await page.setViewportSize({ width, height: 844 });
      await page.goto(
        `${adminIsolatedAppUrl}/admin/support?ticket=${encodeURIComponent(ticket?.id ?? "")}`,
      );
      await page.evaluate((stored) => {
        globalThis.localStorage.setItem("overture.theme", stored);
      }, theme);
      await page.reload();

      await expect(page.getByRole("heading", { name: "Support queue" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Charged twice" })).toBeVisible();
      await expectNoHorizontalOverflow(page, label);

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `axe violations at ${label}`).toEqual([]);

      await owner.dispose();
    });
  }
}
