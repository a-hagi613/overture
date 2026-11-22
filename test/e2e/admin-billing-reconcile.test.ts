import { AxeBuilder } from "@axe-core/playwright";

import { eq } from "drizzle-orm";

import { copy } from "../../src/shared/copy.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import {
  billingReconciliations,
  grants,
  ledger,
  users,
} from "../../src/server/platform/db/schema.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import type { AppServer } from "./app-server.ts";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";

const DAY_MS = 86_400_000;

interface StoredResult {
  checkedAt: number;
  day: string;
  ledgerGrants: number;
  ledgerRefunds: number;
  mismatchTotal: number;
  mismatches: {
    amountCents: number | null;
    id: string;
    kind: string;
  }[];
  status: "clean" | "mismatch";
  stripeInvoices: number;
  stripeRefunds: number;
}

function storeResult(server: AppServer, result: StoredResult) {
  const { db, sqlite } = openDatabase(server.databasePath);

  try {
    db.insert(billingReconciliations)
      .values({
        checkedAt: result.checkedAt,
        day: result.day,
        detail: JSON.stringify({
          mismatchTotal: result.mismatchTotal,
          mismatches: result.mismatches,
        }),
        ledgerGrants: result.ledgerGrants,
        ledgerRefunds: result.ledgerRefunds,
        mismatches: result.mismatchTotal,
        status: result.status,
        stripeInvoices: result.stripeInvoices,
        stripeRefunds: result.stripeRefunds,
        windowEnd: result.checkedAt,
        windowStart: result.checkedAt - DAY_MS,
      })
      .onConflictDoUpdate({
        set: {
          detail: JSON.stringify({
            mismatchTotal: result.mismatchTotal,
            mismatches: result.mismatches,
          }),
          mismatches: result.mismatchTotal,
          status: result.status,
        },
        target: billingReconciliations.day,
      })
      .run();
  } finally {
    sqlite.close();
  }
}

function seedPaidPeriod(server: AppServer) {
  const { db, sqlite } = openDatabase(server.databasePath);
  const at = createClock().now();
  const grantId = "grant-billing-view";

  try {
    const owner = db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, authTestIdentity.ownerEmail))
      .get();

    if (owner === undefined) {
      throw new Error("the owner is missing from the admin database");
    }

    db.insert(grants)
      .values({
        createdAt: at,
        expiresAt: at + 30 * DAY_MS,
        id: grantId,
        quantity: 300,
        source: "period",
        startsAt: at,
        stripeInvoiceId: "in_admin_billing_view",
        userId: owner.id,
      })
      .run();

    db.insert(ledger)
      .values({
        amount: 300,
        applicationId: null,
        createdAt: at,
        creditAccount: "available",
        debitAccount: "issued",
        grantId,
        id: "ledger-billing-view",
        idempotencyKey: "stripe-invoice:in_admin_billing_view",
        kind: "grant",
        userId: owner.id,
      })
      .run();

    return owner;
  } finally {
    sqlite.close();
  }
}

test("the billing page shows the last reconciliation, its mismatches and an axe-clean empty state", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  await page.goto(`${adminIsolatedAppUrl}/admin/billing`);

  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: copy.admin.billingReconcileHeading }),
  ).toBeVisible();
  await expect(page.getByText(copy.admin.billingReconcileNone, { exact: true })).toBeVisible();

  const empty = await new AxeBuilder({ page }).analyze();

  expect(empty.violations).toEqual([]);

  storeResult(adminIsolatedAppServer, {
    checkedAt: createClock().now(),
    day: "2026-11-19",
    ledgerGrants: 2,
    ledgerRefunds: 0,
    mismatchTotal: 0,
    mismatches: [],
    status: "clean",
    stripeInvoices: 2,
    stripeRefunds: 0,
  });

  await page.reload();

  await expect(page.getByText("Clean", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Stripe and the ledger agree for 2026-11-19: 2 paid invoices and 0 refunds.", {
      exact: true,
    }),
  ).toBeVisible();

  const clean = await new AxeBuilder({ page }).analyze();

  expect(clean.violations).toEqual([]);

  storeResult(adminIsolatedAppServer, {
    checkedAt: createClock().now(),
    day: "2026-11-20",
    ledgerGrants: 2,
    ledgerRefunds: 0,
    mismatchTotal: 2,
    mismatches: [
      { amountCents: 3500, id: "in_ghost", kind: "invoice_without_grant" },
      { amountCents: 3500, id: "re_ghost", kind: "refund_without_ledger" },
    ],
    status: "mismatch",
    stripeInvoices: 3,
    stripeRefunds: 1,
  });

  await page.reload();

  await expect(page.getByText("Mismatch", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2 mismatches for 2026-11-20. The owner has been alerted.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Paid invoice with no grant: in_ghost", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Refund with no ledger entry: re_ghost", { exact: true }),
  ).toBeVisible();

  const mismatch = await new AxeBuilder({ page }).analyze();

  expect(mismatch.violations).toEqual([]);

  await page.setViewportSize({ height: 844, width: 390 });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflows).toBe(false);

  const phone = await new AxeBuilder({ page }).analyze();

  expect(phone.violations).toEqual([]);
});

test("the per-user billing view and its refund page are reachable and axe clean", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const owner = seedPaidPeriod(adminIsolatedAppServer);

  await page.goto(`${adminIsolatedAppUrl}/admin/billing/users/${owner.id}`);

  await expect(
    page.getByRole("heading", { name: copy.admin.billingUserNameFallback }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText(authTestIdentity.ownerEmail, { exact: true }),
  ).toBeVisible();

  const userView = await new AxeBuilder({ page }).analyze();

  expect(userView.violations).toEqual([]);

  await page.goto(`${adminIsolatedAppUrl}/admin/billing/users/${owner.id}/refund`);

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `${copy.admin.billingRefundTitlePlain} ${copy.admin.billingRefundTitleItalic}`,
    }),
  ).toBeVisible();

  const refund = await new AxeBuilder({ page }).analyze();

  expect(refund.violations).toEqual([]);
});
