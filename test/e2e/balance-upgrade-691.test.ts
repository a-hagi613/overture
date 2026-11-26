import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  appNowSeconds,
  BILLING_CUSTOMER_ID,
  BILLING_PRICE_MONTH,
  BILLING_PRICE_WEEK,
  BILLING_SECRET_KEY,
  BILLING_WEBHOOK_SECRET,
  postWebhook,
  signInOwner,
  signPayload,
} from "./billing-harness.ts";
import { seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

const SHOT_DIR = join(process.cwd(), "docs/screenshots/691");
const SUBSCRIPTION_ID = "sub_e2e_balance_upgrade";
const DAY_SECONDS = 86_400;

const paidTemplate = readFileSync("test/e2e/fixtures/stripe/invoice-paid.json", "utf8");

const subscriptionTemplate = readFileSync(
  "test/e2e/fixtures/stripe/subscription-updated.json",
  "utf8",
);

const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });
const createdSchema = z.object({ id: z.string() });

const billingSchema = z.object({
  applicationsLeft: z.number(),
  balance: z.object({
    expiring: z.object({ applications: z.number(), expiresAt: z.number() }).nullable(),
    paid: z.object({ granted: z.number(), left: z.number(), used: z.number() }),
    released: z.number(),
    reserved: z.number(),
    trial: z.object({ granted: z.number(), left: z.number(), used: z.number() }),
    used: z.number(),
  }),
  planKind: z.enum(["month", "none", "trial", "week"]),
});

function subscriptionPayload(input: {
  end: number;
  eventId: string;
  ownerId: string;
  plan: "week" | "month";
  start: number;
}) {
  return subscriptionTemplate
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__EVENT_TYPE__", "customer.subscription.updated")
    .replaceAll("__SUBSCRIPTION_ID__", SUBSCRIPTION_ID)
    .replaceAll("__USER_ID__", input.ownerId)
    .replaceAll("__CUSTOMER_ID__", BILLING_CUSTOMER_ID)
    .replaceAll("__PLAN__", input.plan)
    .replaceAll("__PRICE_ID__", input.plan === "week" ? BILLING_PRICE_WEEK : BILLING_PRICE_MONTH)
    .replaceAll("__STATUS__", "active")
    .replaceAll('"__CANCEL_AT_PERIOD_END__"', "false")
    .replaceAll('"__PERIOD_START__"', String(input.start))
    .replaceAll('"__PERIOD_END__"', String(input.end));
}

function invoicePayload(input: {
  end: number;
  eventId: string;
  invoiceId: string;
  ownerId: string;
  plan: "week" | "month";
  start: number;
}) {
  return paidTemplate
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.ownerId)
    .replaceAll("__PLAN__", input.plan)
    .replaceAll("__PRICE_ID__", input.plan === "week" ? BILLING_PRICE_WEEK : BILLING_PRICE_MONTH)
    .replaceAll('"__PERIOD_START__"', String(input.start))
    .replaceAll('"__PERIOD_END__"', String(input.end));
}

async function inSequence<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  const [first, ...rest] = items;

  if (first === undefined) {
    return;
  }

  await run(first);
  await inSequence(rest, run);
}

async function deliver(request: APIRequestContext, appUrl: string, payload: string) {
  const response = await postWebhook(
    request,
    appUrl,
    payload,
    signPayload(payload, await appNowSeconds(request, appUrl)),
  );

  expect(webhookResultSchema.parse(await response.json())).toStrictEqual({ result: "processed" });
}

async function seedUsedTrial(request: APIRequestContext, appUrl: string, ownerId: string) {
  const grant = await request.post(`${appUrl}/__test__/ledger/grant`, {
    data: {
      email: authTestIdentity.ownerEmail,
      idempotencyKey: `e2e-691-trial:${ownerId}`,
      quantity: 3,
      source: "trial",
    },
  });

  expect(grant.ok()).toBe(true);

  await request.post(`${appUrl}/__test__/profile/running`, {
    data: { running: true, userId: ownerId },
  });

  const companyId = await seedCompany(request, "Northwind Labs", "northwind.example");
  const boardId = await seedBoard(request, companyId, "greenhouse", "northwind");
  const now = (await appNowSeconds(request, appUrl)) * 1000;

  await inSequence([0, 1, 2], async (index) => {
    const postingId = await seedPosting(request, {
      atsJobId: `691-${String(index)}`,
      boardId,
      companyId,
      title: "Platform Engineer",
      url: `https://northwind.example/691/${String(index)}`,
    });

    const applicationId = createdSchema.parse(
      await (
        await request.post(`${appUrl}/__test__/applications/seed`, {
          data: {
            createdAt: now,
            origin: "auto",
            postingId,
            sentAt: now,
            stage: "applied",
            status: "sent",
            userId: ownerId,
          },
        })
      ).json(),
    ).id;

    const used = await request.post(`${appUrl}/__test__/ledger/application`, {
      data: { applicationId, commit: true, email: authTestIdentity.ownerEmail },
    });

    expect(used.ok()).toBe(true);
  });
}

async function openPage(
  browser: Browser,
  storage: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  width: number,
  theme: "light" | "dark",
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState: storage,
    viewport: { height: width === 1280 ? 900 : 844, width },
  });

  const page = await context.newPage();

  await page.addInitScript((value: string) => {
    globalThis.localStorage.setItem("overture.theme", value);
    globalThis.localStorage.setItem("overture.rail", "0");
  }, theme);

  return { context, page };
}

async function expectClean(page: Page, label: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow, `horizontal overflow at ${label}`).toBeLessThanOrEqual(0);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `axe at ${label}`).toEqual([]);
}

async function shoot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: join(SHOT_DIR, `${name}.png`) });
}

test.describe("balance, upgrade and the used-up trial", () => {
  test.setTimeout(240_000);

  test("a used trial shows the Home banner and Upgrade, and buying Weekly keeps the Tracker history", async ({
    browser,
    identityServer,
  }) => {
    const stripe = await startStripeMock();

    const server = await startFreshAppServer(identityServer, {
      STRIPE_API_BASE_URL: stripe.url,
      STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
      STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
      STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
    });

    const api = await apiRequest.newContext({ baseURL: server.url });

    try {
      const ownerId = await signInOwner(api, server.url);

      await seedUsedTrial(api, server.url, ownerId);

      const trialBilling = billingSchema.parse(
        await (await api.get(`${server.url}/api/billing`)).json(),
      );

      expect(trialBilling.planKind).toBe("trial");
      expect(trialBilling.applicationsLeft).toBe(0);
      expect(trialBilling.balance.trial).toStrictEqual({ granted: 3, left: 0, used: 3 });

      const homeResponse = await api.get(`${server.url}/api/home`);

      expect(homeResponse.status()).toBe(200);
      expect(await homeResponse.json()).toMatchObject({
        applicationsLeft: 0,
        planKind: "trial",
        trialUsed: true,
      });

      const storage = await api.storageState();

      const cases = [390, 1280].flatMap((width) =>
        (["light", "dark"] as const).map((theme) => ({ theme, width })),
      );

      await inSequence(cases, async ({ theme, width }) => {
        const { context, page } = await openPage(browser, storage, width, theme);

        try {
          const label = `${String(width)}px ${theme}`;

          await page.goto(`${server.url}/home`);

          await expect(page.getByTestId("home-trial-used")).toBeVisible();
          await expect(
            page.getByRole("heading", { name: "Your 3 free applications are sent." }),
          ).toBeVisible();
          await expect(page.getByText("Upgrade to keep applying.")).toBeVisible();
          await expect(
            page.getByRole("link", { name: "Upgrade to Weekly / Monthly" }).last(),
          ).toBeVisible();

          if (width === 1280) {
            const balance = page.getByTestId("sidebar-balance");

            await expect(balance.getByText("Free trial", { exact: true })).toBeVisible();
            await expect(balance.getByText(/0 applications left · 3 of 10 today/u)).toBeVisible();
            await expect(
              balance.getByRole("link", { name: "Upgrade to Weekly / Monthly" }),
            ).toBeVisible();
          }

          await expectClean(page, `home ${label}`);
          await shoot(page, `${String(width)}-${theme}-home`);

          await page.goto(`${server.url}/profile/billing`);

          await expect(page.getByRole("heading", { level: 2, name: "Free trial" })).toBeVisible();
          await expect(page.getByText("3 granted · 3 used · 0 left")).toBeVisible();
          await expect(page.getByText("0 granted · 0 used · 0 left")).toBeVisible();

          await expectClean(page, `billing ${label}`);
          await shoot(page, `${String(width)}-${theme}-billing`);
        } finally {
          await context.close();
        }
      });

      const paying = await openPage(browser, storage, 1280, "light");

      try {
        await paying.page.goto(`${server.url}/profile/billing?billing=success`);

        await expect(
          paying.page.getByRole("heading", { level: 2, name: "Free trial" }),
        ).toBeVisible();

        const now = await appNowSeconds(api, server.url);
        const end = now + 7 * DAY_SECONDS;

        await deliver(
          api,
          server.url,
          subscriptionPayload({
            end,
            eventId: "evt_691_sub_week",
            ownerId,
            plan: "week",
            start: now,
          }),
        );

        await deliver(
          api,
          server.url,
          invoicePayload({
            end,
            eventId: "evt_691_paid_week",
            invoiceId: "in_691_week",
            ownerId,
            plan: "week",
            start: now,
          }),
        );

        const afterPaid = billingSchema.parse(
          await (await api.get(`${server.url}/api/billing`)).json(),
        );

        expect(afterPaid.planKind).toBe("week");
        expect(afterPaid.applicationsLeft).toBe(50);
        expect(afterPaid.balance.paid).toStrictEqual({ granted: 50, left: 50, used: 0 });
        expect(afterPaid.balance.trial).toStrictEqual({ granted: 3, left: 0, used: 3 });

        await expect(
          paying.page.getByRole("heading", { exact: true, level: 2, name: "Weekly" }),
        ).toBeVisible({ timeout: 20_000 });
        await expect(paying.page.getByText("50 of 50 applications left")).toBeVisible();
        await expect(paying.page.getByText("50 granted · 0 used · 50 left")).toBeVisible();

        const balance = paying.page.getByTestId("sidebar-balance");

        await expect(balance.getByText("Weekly", { exact: true })).toBeVisible();
        await expect(balance.getByText(/50 applications left · /u)).toBeVisible();
        await expect(balance.getByRole("link", { name: "Manage plan" })).toBeVisible();

        await expectClean(paying.page, "billing weekly 1280px light");
        await shoot(paying.page, "1280-light-weekly-billing");

        await paying.page.goto(`${server.url}/tracker`);

        await expect(
          paying.page.getByRole("heading", { level: 1, name: "Application Tracker" }),
        ).toBeVisible();
        await expect(paying.page.getByText("Northwind Labs").first()).toBeVisible();
      } finally {
        await paying.context.close();
      }
    } finally {
      await api.dispose();
      await stripe.stop();
      await server.stop();
    }
  });
});
