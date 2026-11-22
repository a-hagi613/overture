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

const reservationSchema = z.object({ applicationsLeft: z.number() });
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
  input: { eventId: string; invoiceId: string; ownerId: string; start: number; end: number },
) {
  return template
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.ownerId)
    .replaceAll("__PLAN__", "month")
    .replaceAll("__PRICE_ID__", BILLING_PRICE_MONTH)
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

async function subscribeMonth(app: BillingApp) {
  const now = await appNowSeconds(app.api, app.server.url);
  const end = now + 30 * DAY_SECONDS;

  await deliver(
    app.api,
    app.server.url,
    subscriptionPayload({
      cancelAtPeriodEnd: false,
      end,
      eventId: "evt_settings_billing_sub_1",
      ownerId: app.ownerId,
      plan: "month",
      start: now,
    }),
  );

  await deliver(
    app.api,
    app.server.url,
    invoicePayload(paidTemplate, {
      end,
      eventId: "evt_settings_billing_paid_1",
      invoiceId: "in_settings_billing_1",
      ownerId: app.ownerId,
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

test.describe("plan and billing in Settings, and the paused and out-of-applications states", () => {
  test.setTimeout(240_000);

  test("Settings shows the plan, Applications left and renewal, and hands plan changes and payment to Stripe", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      await subscribeMonth(app);

      const billing = billingSchema.parse(
        await (await app.api.get(`${app.server.url}/api/billing`)).json(),
      );

      expect(billing).toMatchObject({ applicationsLeft: 300, plan: "month" });

      const { close, page } = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await page.goto(`${app.server.url}/settings/billing`);

        await expect(page.getByRole("heading", { name: /Plan/u, level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
        await expect(page.getByText("Month plan")).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Your plan" }).getByText("300", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("of 300 this period")).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Your plan" }).getByText(/^Renews/u),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Switch to Week at renewal" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Cancel at period end" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Manage payment in Stripe" })).toBeVisible();

        await page.getByRole("button", { name: "Switch to Week at renewal" }).click();

        await expect
          .poll(() => app.stripe.requests.some((r) => r.path === "/v1/billing_portal/sessions"))
          .toBe(true);
      } finally {
        await close();
      }

      await subscribeCancelAtEnd(app);

      const cancelling = await openPage(browser, app, { dark: false, width: 390 });

      try {
        await cancelling.page.goto(`${app.server.url}/settings/billing`);

        await expect(cancelling.page.getByText(/Your plan stays on until/u)).toBeVisible();
        await expect(
          cancelling.page.getByRole("button", { name: "Cancel at period end" }),
        ).toHaveCount(0);
        await expectNoOverflow(cancelling.page, "390px settings billing, cancelling");
      } finally {
        await cancelling.close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("a failed payment pauses Home, and its fix opens Settings billing", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      await subscribeMonth(app);

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
        await page.goto(`${app.server.url}/`);

        await expect(page.getByText("Payment didn't go through.")).toBeVisible();
        await page.getByRole("link", { name: "Update payment" }).click();

        await expect(page).toHaveURL(/\/settings\/billing$/u);
        await expect(page.getByRole("heading", { name: "Plan and billing" })).toBeVisible();
      } finally {
        await close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("a plan that has ended pauses Home, and its fix chooses a plan", async ({
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
        await page.goto(`${app.server.url}/`);

        await expect(page.getByText("Your plan has ended.")).toBeVisible();
        await page.getByRole("link", { name: "Choose a plan" }).click();

        await expect(page).toHaveURL(/\/settings\/billing\/plans$/u);
        await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Choose Week" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Choose Month" })).toBeVisible();
        await expectNoOverflow(page, "390px choose a plan, dark");
      } finally {
        await close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("an invite grant running out shows its Applications left and end date, and then out of Applications", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      const now = await appNowSeconds(app.api, app.server.url);
      const grantEnd = (now + 37 * DAY_SECONDS) * 1000;

      await app.api.post(`${app.server.url}/__test__/ledger/grant`, {
        data: {
          email: authTestIdentity.ownerEmail,
          expiresAt: grantEnd,
          idempotencyKey: "grant:settings-billing-invite",
          quantity: 2,
          source: "admin",
        },
      });

      expect(await homeState(app)).toMatchObject({
        applicationsLeft: 2,
        endingGrant: { applicationsLeft: 2, expiresAt: grantEnd },
      });

      const { close, page } = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await page.goto(`${app.server.url}/`);

        await expect(page.getByText("Invite grant running out.")).toBeVisible();
        await expect(
          page.getByText(/Your invite grant has 2 Applications left and ends on/u),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "Choose a plan" })).toBeVisible();

        await inSequence(
          ["app_settings_billing_1", "app_settings_billing_2"],
          async (applicationId) => {
            const reserved = reservationSchema.parse(
              await (
                await app.api.post(`${app.server.url}/__test__/ledger/application`, {
                  data: { applicationId, commit: true, email: authTestIdentity.ownerEmail },
                })
              ).json(),
            );

            expect(reserved.applicationsLeft).toBeGreaterThanOrEqual(0);
          },
        );

        await page.reload();

        await expect(page.getByText("Out of Applications.")).toBeVisible();
        await expect(page.getByText("Invite grant running out.")).toHaveCount(0);
        await expect(page.getByRole("link", { name: "See the Board" })).toBeVisible();
        await shoot(page, "home-out-of-applications-1280-light");
      } finally {
        await close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("Choose a plan shows the Checkout return states and starts Checkout for a plan", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      const { close, page } = await openPage(browser, app, { dark: false, width: 1280 });

      try {
        await page.goto(`${app.server.url}/settings/billing/plans?billing=cancelled`);

        await expect(page.getByText("Checkout not finished")).toBeVisible();
        await expect(
          page.getByText("Nothing was charged. Your plan has not changed."),
        ).toBeVisible();

        await page.goto(`${app.server.url}/settings/billing/plans?billing=success`);

        await expect(page.getByText("Checking the payment")).toBeVisible();

        await page.goto(`${app.server.url}/settings/billing/plans`);
        await page.getByRole("button", { name: "Choose Week" }).click();

        await expect
          .poll(() => app.stripe.requests.some((r) => r.path === "/v1/checkout/sessions"))
          .toBe(true);
      } finally {
        await close();
      }

      await subscribeMonth(app);

      const returned = await openPage(browser, app, { dark: true, width: 768 });

      try {
        await returned.page.goto(`${app.server.url}/settings/billing/plans?billing=success`);

        await expect(returned.page.getByText("Plan started")).toBeVisible();
        await expect(returned.page.getByText("Month plan on")).toBeVisible();
        await expectAxeClean(returned.page, "768px plans, dark");
      } finally {
        await returned.close();
      }
    } finally {
      await stopBillingApp(app);
    }
  });

  test("every billing and paused page is overflow-free and axe clean from 390 to 2560, in light and dark", async ({
    browser,
    identityServer,
  }) => {
    const app = await startBillingApp(identityServer);

    try {
      await subscribeMonth(app);

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
          path: "/",
          ready: (page: Page) => page.getByText("Payment didn't go through."),
        },
        {
          name: "settings-billing",
          path: "/settings/billing",
          ready: (page: Page) => page.getByRole("heading", { name: "Plan and billing" }),
        },
        {
          name: "billing-plans",
          path: "/settings/billing/plans",
          ready: (page: Page) => page.getByRole("heading", { name: "Choose a plan" }),
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

async function subscribeCancelAtEnd(app: BillingApp) {
  const now = await appNowSeconds(app.api, app.server.url);

  await deliver(
    app.api,
    app.server.url,
    subscriptionPayload({
      cancelAtPeriodEnd: true,
      end: now + 30 * DAY_SECONDS,
      eventId: "evt_settings_billing_cancel_1",
      ownerId: app.ownerId,
      plan: "month",
      start: now,
    }),
  );
}
