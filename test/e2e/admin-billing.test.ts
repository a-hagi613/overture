import { AxeBuilder } from "@axe-core/playwright";
import type { APIRequestContext, Page, Request as PlaywrightRequest } from "@playwright/test";
import { z } from "zod";

import {
  enableVirtualAuthenticator,
  openAdminAsOwner,
  signInOwnerOnAdmin,
} from "./admin-sign-in.ts";
import { adminUrlOf, expect, startFreshAdminServer, test as adminTest } from "./admin.fixture.ts";
import type { AppServer } from "./app-server.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import {
  appNowSeconds,
  BILLING_PRICE_MONTH,
  BILLING_PRICE_WEEK,
  BILLING_SECRET_KEY,
  BILLING_WEBHOOK_SECRET,
  deliverInvoice,
  failedInvoicePayload,
  invoicePayload,
  signInOwner,
} from "./billing-harness.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";
import type { StripeMock } from "./stripe-mock.fixture.ts";

const DAY_SECONDS = 86_400;
const NOTE = "Charged twice in the same billing period";
const REFUND_PATH = "/admin/api/billing/refunds";

const refundResponseSchema = z.object({ replayed: z.boolean() });

const refundRequestSchema = z.record(z.string(), z.unknown());

const billingUserSchema = z.object({
  user: z.object({
    refundable: z.boolean(),
    current: z.object({ grantId: z.string(), refunded: z.boolean() }).nullable(),
  }),
});

const test = adminTest.extend<
  { billingAdminServer: AppServer; billingAdminUrl: string },
  { _stripeMock: StripeMock }
>({
  _stripeMock: [
    async ({ browser: _browser }, provide) => {
      const stripe = await startStripeMock();

      await provide(stripe);
      await stripe.stop();
    },
    { scope: "worker" },
  ],
  billingAdminServer: async (
    { _identityServerWorker, _accessServerWorker, _stripeMock },
    provide,
  ) => {
    const server = await startFreshAdminServer(_identityServerWorker, _accessServerWorker, 4, {
      STRIPE_API_BASE_URL: _stripeMock.url,
      STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
      STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
      STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
    });

    await provide(server);
    await server.stop();
  },
  billingAdminUrl: async ({ billingAdminServer }, provide) => {
    await provide(adminUrlOf(billingAdminServer));
  },
});

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, label).toEqual([]);
}

async function seedPaidMonth(request: APIRequestContext, appUrl: string) {
  const ownerId = await signInOwner(request, appUrl);
  const now = await appNowSeconds(request, appUrl);

  const delivered = await deliverInvoice(
    request,
    appUrl,
    invoicePayload({
      eventId: "evt_admin_billing_paid_1",
      invoiceId: "in_admin_billing_1",
      periodEnd: now + 30 * DAY_SECONDS,
      periodStart: now,
      userId: ownerId,
    }),
  );

  expect(delivered.status()).toBe(200);

  return ownerId;
}

test("the owner passkey gates the billing pages until the passkey is added", async ({
  page,
  billingAdminUrl,
  billingAdminServer,
  accessServer,
}) => {
  test.setTimeout(120_000);

  await seedPaidMonth(page.request, billingAdminServer.url);
  await enableVirtualAuthenticator(page);
  await signInOwnerOnAdmin(page, billingAdminUrl);
  await page.context().addCookies([
    {
      name: "CF_Authorization",
      value: await accessServer.issueToken({ email: authTestIdentity.ownerEmail }),
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${billingAdminUrl}/admin/billing`);

  await expect(page.getByRole("button", { name: "Add your passkey" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.getByRole("button", { name: "Add your passkey" }).click();

  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("the billing list filters rows and opens a user's billing view without card data", async ({
  page,
  billingAdminUrl,
  billingAdminServer,
  accessServer,
}) => {
  test.setTimeout(120_000);

  const ownerId = await seedPaidMonth(page.request, billingAdminServer.url);

  await openAdminAsOwner(page, billingAdminUrl, accessServer.issueToken);
  await page.goto(`${billingAdminUrl}/admin/billing`);

  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(
    page.getByRole("table").getByRole("link", { name: authTestIdentity.ownerEmail }),
  ).toBeVisible();
  await expectAxeClean(page, "billing list");

  await page.getByRole("button", { name: "Paused" }).click();
  await expect(
    page.getByText("No users match this filter.").filter({ visible: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Paying" }).click();
  await expect(page.getByText("No users match this filter.").filter({ visible: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("table").getByRole("link", { name: authTestIdentity.ownerEmail }),
  ).toBeVisible();

  await page.getByRole("table").getByRole("link").first().click();

  await expect(page).toHaveURL(
    new RegExp(`/admin/billing/users/${encodeURIComponent(ownerId)}$`, "u"),
  );
  await expect(page.getByRole("heading", { name: "The payment", exact: true })).toBeVisible();
  await expect(page.getByText(/last4|\*\*\*\*|brand/iu)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Refund this period" })).toBeVisible();
  await expectAxeClean(page, "per-user billing view");
});

test("a refund is recorded once: a failed send can be retried with the same key and a replay changes nothing", async ({
  page,
  billingAdminUrl,
  billingAdminServer,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const ownerId = await seedPaidMonth(page.request, billingAdminServer.url);
  const userPath = `/admin/billing/users/${encodeURIComponent(ownerId)}`;

  await openAdminAsOwner(page, billingAdminUrl, accessServer.issueToken);
  await page.goto(`${billingAdminUrl}${userPath}`);
  await page.getByRole("link", { name: "Refund this period" }).click();

  await expect(page).toHaveURL(
    `${billingAdminUrl}/admin/billing/users/${encodeURIComponent(ownerId)}/refund`,
  );
  await expect(page.getByLabel("Reason (required)")).toBeVisible();

  const posted: PlaywrightRequest[] = [];

  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(REFUND_PATH)) {
      posted.push(request);
    }
  });
  await page.route(`**${REFUND_PATH}`, async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await page.getByLabel("Reason (required)").selectOption("charged_twice");
  await page.getByLabel("Note for the audit log (required)").fill(NOTE);
  await page.getByRole("button", { name: "Refund the period" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "The refund did not go through. Nothing was refunded. Try again.",
  );

  await page.unroute(`**${REFUND_PATH}`);
  await page.getByRole("button", { name: "Refund the period" }).click();

  await expect(
    page.getByText("Refunded. The unused Applications have stopped.", { exact: true }),
  ).toBeVisible();

  expect(posted).toHaveLength(2);

  const firstBody = z
    .object({ idempotencyKey: z.string() })
    .parse(JSON.parse(posted[0]?.postData() ?? "{}"));

  const secondBody = z
    .object({ idempotencyKey: z.string() })
    .parse(JSON.parse(posted[1]?.postData() ?? "{}"));

  expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);

  const replay = await page.request.post(`${billingAdminUrl}${REFUND_PATH}`, {
    data: refundRequestSchema.parse(JSON.parse(posted[1]?.postData() ?? "{}")),
  });

  expect(replay.status()).toBe(200);
  expect(refundResponseSchema.parse(await replay.json()).replayed).toBe(true);

  const user = billingUserSchema.parse(
    await (
      await page.request.get(
        `${billingAdminUrl}/admin/api/billing/users/${encodeURIComponent(ownerId)}`,
      )
    ).json(),
  );

  expect(user.user.current?.refunded).toBe(true);
  expect(user.user.refundable).toBe(false);

  await page.goto(`${billingAdminUrl}${userPath}`);
  await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();
  await expectAxeClean(page, "per-user view after refund");
});

test("a failed renewal shows the user as paused in the list and on the user view", async ({
  page,
  billingAdminUrl,
  billingAdminServer,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const ownerId = await seedPaidMonth(page.request, billingAdminServer.url);
  const now = await appNowSeconds(page.request, billingAdminServer.url);

  const started = await page.request.post(`${billingAdminServer.url}/__test__/profile/running`, {
    data: { running: true, userId: ownerId },
  });

  expect(started.ok()).toBe(true);

  const failed = await deliverInvoice(
    page.request,
    billingAdminServer.url,
    failedInvoicePayload({
      eventId: "evt_admin_billing_failed_1",
      invoiceId: "in_admin_billing_failed_1",
      periodEnd: now + 30 * DAY_SECONDS,
      periodStart: now,
      userId: ownerId,
    }),
  );

  expect(failed.status()).toBe(200);

  await openAdminAsOwner(page, billingAdminUrl, accessServer.issueToken);
  await page.goto(`${billingAdminUrl}/admin/billing`);
  await page.getByRole("button", { name: "Paused" }).click();

  await expect(
    page.getByRole("table").getByRole("link", { name: authTestIdentity.ownerEmail }),
  ).toBeVisible();
  await expect(page.getByRole("table").getByText("Paused: payment failed")).toBeVisible();

  await page.goto(`${billingAdminUrl}/admin/billing/users/${encodeURIComponent(ownerId)}`);

  await expect(page.getByText(/Paused: payment failed/u).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Refund this period" })).toBeVisible();
});

test("two refund requests for one period at once record one refund", async ({
  page,
  billingAdminUrl,
  billingAdminServer,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const ownerId = await seedPaidMonth(page.request, billingAdminServer.url);

  await openAdminAsOwner(page, billingAdminUrl, accessServer.issueToken);

  const grantId = billingUserSchema.parse(
    await (
      await page.request.get(
        `${billingAdminUrl}/admin/api/billing/users/${encodeURIComponent(ownerId)}`,
      )
    ).json(),
  ).user.current?.grantId;

  expect(grantId).toBeDefined();

  const send = async (idempotencyKey: string) =>
    page.request.post(`${billingAdminUrl}${REFUND_PATH}`, {
      data: { amountCents: null, grantId, idempotencyKey, note: NOTE, reason: "charged_twice" },
    });

  const [first, second] = await Promise.all([send("race-key-a"), send("race-key-b")]);
  const statuses = [first.status(), second.status()].toSorted((a, b) => a - b);

  expect(statuses).toEqual([200, 409]);
});

test("a reused refund key with a different request is refused", async ({
  page,
  billingAdminUrl,
  billingAdminServer,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const ownerId = await seedPaidMonth(page.request, billingAdminServer.url);

  await openAdminAsOwner(page, billingAdminUrl, accessServer.issueToken);

  const grantId = billingUserSchema.parse(
    await (
      await page.request.get(
        `${billingAdminUrl}/admin/api/billing/users/${encodeURIComponent(ownerId)}`,
      )
    ).json(),
  ).user.current?.grantId;

  const body = {
    amountCents: null,
    grantId,
    idempotencyKey: "reuse-key",
    note: NOTE,
    reason: "charged_twice",
  };

  expect(
    (await page.request.post(`${billingAdminUrl}${REFUND_PATH}`, { data: body })).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`${billingAdminUrl}${REFUND_PATH}`, {
        data: { ...body, amountCents: 500, reason: "goodwill" },
      })
    ).status(),
  ).toBe(422);
});

const reviewScreens = [
  { name: "billing", path: () => "/admin/billing" },
  {
    name: "billing-user",
    path: (ownerId: string) => `/admin/billing/users/${encodeURIComponent(ownerId)}`,
  },
] as const;

const reviewViewports = [390, 1280] as const;
const reviewThemes = ["light", "dark"] as const;

test.describe("review screenshots", () => {
  test.skip(process.env.BILLING_SHOT_DIR === undefined, "only when capturing review screenshots");

  for (const width of reviewViewports) {
    for (const theme of reviewThemes) {
      for (const screen of reviewScreens) {
        test(`captures ${screen.name} at ${String(width)} ${theme}`, async ({
          page,
          billingAdminUrl,
          billingAdminServer,
          accessServer,
        }) => {
          test.setTimeout(180_000);

          const ownerId = await seedPaidMonth(page.request, billingAdminServer.url);

          await page.addInitScript((stored) => {
            globalThis.localStorage.setItem("overture.theme", stored);
          }, theme);
          await page.setViewportSize({ width, height: 844 });
          await openAdminAsOwner(page, billingAdminUrl, accessServer.issueToken);
          await page.goto(`${billingAdminUrl}${screen.path(ownerId)}`);
          await expect(
            page.getByRole("heading", { name: /Billing|The payment/u }).first(),
          ).toBeVisible();
          await page.screenshot({
            fullPage: true,
            path: `${process.env.BILLING_SHOT_DIR ?? ""}/${screen.name}-${String(width)}-${theme}.png`,
          });
        });
      }
    }
  }
});
