import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";

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
import { startStripeMock } from "./stripe-mock.fixture.ts";

const paidTemplate = readFileSync("test/e2e/fixtures/stripe/invoice-paid.json", "utf8");
const failedTemplate = readFileSync("test/e2e/fixtures/stripe/invoice-payment-failed.json", "utf8");

const subscriptionTemplate = readFileSync(
  "test/e2e/fixtures/stripe/subscription-updated.json",
  "utf8",
);

const DAY_SECONDS = 86_400;
const SUBSCRIPTION_ID = "sub_e2e_settings_billing";
const WIDTHS = [390, 768, 1280, 1920, 2560] as const;

const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });
const billingSchema = z.object({ applicationsLeft: z.number(), plan: z.string().nullable() });

const homeSchema = z.object({
  applicationsLeft: z.number(),
  endingGrant: z.object({ applicationsLeft: z.number(), expiresAt: z.number() }).nullable(),
  pauseReason: z.string().nullable(),
});

const runDueSchema = z.object({ ran: z.number() });
const clockSchema = z.object({ now: z.number() });

interface BillingApp {
  server: Awaited<ReturnType<typeof startFreshAppServer>>;
  stripe: Awaited<ReturnType<typeof startStripeMock>>;
  ownerId: string;
  api: APIRequestContext;
}

function invoicePayload(
  template: string,
  input: {
    eventId: string;
    invoiceId: string;
    ownerId: string;
    plan?: "week" | "month";
    start: number;
    end: number;
  },
) {
  const plan = input.plan ?? "month";

  return template
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.ownerId)
    .replaceAll("__PLAN__", plan)
    .replaceAll("__PRICE_ID__", plan === "week" ? BILLING_PRICE_WEEK : BILLING_PRICE_MONTH)
    .replaceAll('"__PERIOD_START__"', String(input.start))
    .replaceAll('"__PERIOD_END__"', String(input.end));
}

function subscriptionPayload(input: {
  eventId: string;
  ownerId: string;
  plan: "week" | "month";
  cancelAtPeriodEnd: boolean;
  start: number;
  end: number;
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
    .replaceAll('"__CANCEL_AT_PERIOD_END__"', String(input.cancelAtPeriodEnd))
    .replaceAll('"__PERIOD_START__"', String(input.start))
    .replaceAll('"__PERIOD_END__"', String(input.end));
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

async function startBillingApp(identityServer: Parameters<typeof startFreshAppServer>[0]) {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
    STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
    STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
  });

  const api = await apiRequest.newContext({ baseURL: server.url });
  const ownerId = await signInOwner(api, server.url);

  await api.post(`${server.url}/__test__/profile/running`, {
    data: { running: true, userId: ownerId },
  });

  return { api, ownerId, server, stripe } satisfies BillingApp;
}

async function stopBillingApp(app: BillingApp) {
  await app.api.dispose();
  await app.stripe.stop();
  await app.server.stop();
}

async function subscribePlan(app: BillingApp, plan: "week" | "month") {
  const now = await appNowSeconds(app.api, app.server.url);
  const days = plan === "week" ? 7 : 30;
  const end = now + days * DAY_SECONDS;

  await deliver(
    app.api,
    app.server.url,
    subscriptionPayload({
      cancelAtPeriodEnd: false,
      end,
      eventId: `evt_settings_billing_sub_${plan}_1`,
      ownerId: app.ownerId,
      plan,
      start: now,
    }),
  );

  await deliver(
    app.api,
    app.server.url,
    invoicePayload(paidTemplate, {
      end,
      eventId: `evt_settings_billing_paid_${plan}_1`,
      invoiceId: `in_settings_billing_${plan}_1`,
      ownerId: app.ownerId,
      plan,
      start: now,
    }),
  );
}

async function homeState(app: BillingApp) {
  return homeSchema.parse(await (await app.api.get(`${app.server.url}/api/home`)).json());
}

async function openPage(
  browser: Browser,
  app: BillingApp,
  options: { width: number; dark: boolean },
) {
  const storage = await app.api.storageState();

  const context = await browser.newContext({
    colorScheme: options.dark ? "dark" : "light",
    storageState: storage,
    viewport: { height: 900, width: options.width },
  });

  const page = await context.newPage();

  return {
    close: async () => {
      await context.close();
    },
    page,
  };
}

async function inSequence<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  const [first, ...rest] = items;

  if (first === undefined) {
    return;
  }

  await run(first);
  await inSequence(rest, run);
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(overflow.scroll, `horizontal overflow at ${label}`).toBeLessThanOrEqual(overflow.client);
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `axe at ${label}`).toEqual([]);
}

async function shoot(page: Page, name: string) {
  const dir = process.env.M3_253_SCREENSHOT_DIR;

  if (dir === undefined || dir === "") {
    return;
  }

  mkdirSync(dir, { recursive: true });
  await page.screenshot({ fullPage: true, path: join(dir, `${name}.png`) });
}

test.describe("plan and billing in Profile, and the paused states", () => {
  test.setTimeout(240_000);

  test("Billing shows current Month plan, remaining applications, and opens Stripe portal", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      await subscribePlan(app, "month");

      const billing = billingSchema.parse(
        await (await app.api.get(`${app.server.url}/api/billing`)).json(),
      );

      expect(billing).toMatchObject({ applicationsLeft: 250, plan: "month" });

      const { close, page } = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await page.goto(`${app.server.url}/profile/billing`);

        await expect(
          page.getByRole("heading", { name: /Plan & Billing/u, level: 1 }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { exact: true, name: "Month plan" })).toBeVisible();
        await expect(page.getByText(/250 of 250 applications left/u)).toBeVisible();
        await expect(page.getByRole("heading", { name: "You're on the Month plan" })).toBeVisible();

        await page.getByRole("button", { name: "Manage billing" }).first().click();

        await expect
          .poll(() => app.stripe.requests.some((r) => r.path === "/v1/billing_portal/sessions"))
          .toBe(true);
      } finally {
        await close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("Billing offers contextual upgrade from Free to Week and from Week to Month in Stripe", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      const freeView = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await freeView.page.goto(`${app.server.url}/profile/billing`);

        await expect(freeView.page.getByRole("heading", { name: "Upgrade to Week" })).toBeVisible();
        await freeView.page.getByRole("button", { name: "Upgrade to Week in Stripe" }).click();

        await expect
          .poll(() => app.stripe.requests.some((r) => r.path === "/v1/checkout/sessions"))
          .toBe(true);
      } finally {
        await freeView.close();
      }

      await subscribePlan(app, "week");

      const weekView = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await weekView.page.goto(`${app.server.url}/profile/billing`);

        await expect(weekView.page.getByRole("heading", { name: "Week plan" })).toBeVisible();
        await expect(
          weekView.page.getByRole("heading", { name: "Upgrade to Month" }),
        ).toBeVisible();
        await expect(
          weekView.page.getByRole("button", { name: "Upgrade to Month in Stripe" }),
        ).toBeVisible();
      } finally {
        await weekView.close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("a failed payment pauses Home, and its fix opens Profile billing", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      await subscribePlan(app, "month");

      const now = await appNowSeconds(app.api, app.server.url);

      await deliver(
        app.api,
        app.server.url,
        invoicePayload(failedTemplate, {
          end: now + 30 * DAY_SECONDS,
          eventId: "evt_settings_billing_failed_1",
          invoiceId: "in_settings_billing_failed_1",
          ownerId: app.ownerId,
          start: now,
        }),
      );

      expect(await homeState(app)).toMatchObject({ pauseReason: "payment_failed" });

      const { close, page } = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await page.goto(`${app.server.url}/home`);

        await expect(page.getByText("Payment didn't go through.")).toBeVisible();
        await page.getByRole("link", { name: "Update payment" }).click();

        await expect(page).toHaveURL(/\/profile\/billing$/u);
        await expect(
          page.getByRole("heading", { name: /Plan & Billing/u, level: 1 }),
        ).toBeVisible();
      } finally {
        await close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("a plan that has ended pauses Home, and its fix opens Profile billing", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      const now = await appNowSeconds(app.api, app.server.url);
      const end = now + 3600;

      await deliver(
        app.api,
        app.server.url,
        invoicePayload(paidTemplate, {
          end,
          eventId: "evt_settings_billing_ended_paid_1",
          invoiceId: "in_settings_billing_ended_1",
          ownerId: app.ownerId,
          start: now,
        }),
      );

      const clock = clockSchema.parse(
        await (await app.api.get(`${app.server.url}/__test__/clock`)).json(),
      );

      await app.api.post(`${app.server.url}/__test__/clock/offset`, {
        data: { offsetMs: end * 1000 + 3600 * 1000 - clock.now },
      });

      expect(
        runDueSchema.parse(
          await (await app.api.post(`${app.server.url}/__test__/jobs/run-due`)).json(),
        ).ran,
      ).toBeGreaterThanOrEqual(0);
      expect(await homeState(app)).toMatchObject({ pauseReason: "plan_ended" });

      const { close, page } = await openPage(browser, app, { dark: true, width: 390 });

      try {
        await page.goto(`${app.server.url}/home`);

        await expect(page.getByText("Your plan has ended.")).toBeVisible();
        await page.getByRole("link", { name: "Choose a plan" }).click();

        await expect(page).toHaveURL(/\/profile\/billing$/u);
        await expect(
          page.getByRole("heading", { name: /Plan & Billing/u, level: 1 }),
        ).toBeVisible();
        await expectNoOverflow(page, "390px profile billing, dark");
      } finally {
        await close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("Billing shows Checkout return banners for cancelled and successful returns", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      const { close, page } = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await page.goto(`${app.server.url}/profile/billing?billing=cancelled`);

        await expect(page.getByText("Checkout not finished")).toBeVisible();
        await expect(
          page.getByText("Nothing was charged. Your plan has not changed."),
        ).toBeVisible();

        await page.goto(`${app.server.url}/profile/billing?billing=success`);

        await expect(page.getByText("Checking the payment")).toBeVisible();
      } finally {
        await close();
      }

      await subscribePlan(app, "month");

      const returned = await openPage(browser, app, { dark: true, width: 768 });

      try {
        await returned.page.goto(`${app.server.url}/profile/billing?billing=success`);

        await expect(returned.page.getByText("Plan started")).toBeVisible();
        await expectAxeClean(returned.page, "768px profile billing, dark");
      } finally {
        await returned.close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("billing and paused Home pages are overflow-free and axe clean from 390 to 2560, in light and dark", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      await subscribePlan(app, "month");

      const now = await appNowSeconds(app.api, app.server.url);

      await deliver(
        app.api,
        app.server.url,
        invoicePayload(failedTemplate, {
          end: now + 30 * DAY_SECONDS,
          eventId: "evt_settings_billing_layout_failed_1",
          invoiceId: "in_settings_billing_layout_failed_1",
          ownerId: app.ownerId,
          start: now,
        }),
      );

      const routes = [
        {
          name: "home-paused",
          path: "/home",
          ready: (page: Page) => page.getByText("Payment didn't go through."),
        },
        {
          name: "profile-billing",
          path: "/profile/billing",
          ready: (page: Page) => page.getByRole("heading", { name: /Plan & Billing/u, level: 1 }),
        },
      ] as const;

      const cases = [false, true].flatMap((dark) =>
        WIDTHS.flatMap((width) => routes.map((route) => ({ dark, route, width }))),
      );

      await inSequence(cases, async ({ dark, route, width }) => {
        const label = `${route.name} ${String(width)}px ${dark ? "dark" : "light"}`;
        const { close, page } = await openPage(browser, app, { dark, width });

        try {
          await page.goto(`${app.server.url}${route.path}`);
          await expect(route.ready(page)).toBeVisible();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          await expectNoOverflow(page, label);
          await expectAxeClean(page, label);
          await shoot(page, `${route.name}-${String(width)}-${dark ? "dark" : "light"}`);
        } finally {
          await close();
        }
      });
    } finally {
      await stopBillingApp(app);
    }
  });
});
