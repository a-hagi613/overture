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

interface StoredItem {
  amountCents: number | null;
  id: string;
  result: "matched" | "not_in_overture" | "not_in_stripe";
  userId: string | null;
}

interface StoredResult {
  checkedAt: number;
  day: string;
  items: StoredItem[];
  ledgerGrants: number;
  ledgerRefunds: number;
  matched: number;
  mismatchTotal: number;
  mismatches: {
    amountCents: number | null;
    id: string;
    kind: string;
  }[];
  status: "clean" | "mismatch";
  stripeInvoices: number;
  stripeRefunds: number;
  unrecorded: number;
}

function detailOf(result: StoredResult) {
  return JSON.stringify({
    items: result.items,
    itemsTotal: result.items.length,
    matched: result.matched,
    mismatchTotal: result.mismatchTotal,
    mismatches: result.mismatches,
    unrecorded: result.unrecorded,
  });
}

function storeResult(server: AppServer, result: StoredResult) {
  const { db, sqlite } = openDatabase(server.databasePath);

  try {
    db.insert(billingReconciliations)
      .values({
        checkedAt: result.checkedAt,
        day: result.day,
        detail: detailOf(result),
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
          detail: detailOf(result),
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

function ownerOf(server: AppServer) {
  const { db, sqlite } = openDatabase(server.databasePath);

  try {
    const owner = db
      .select({ email: users.email, id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, authTestIdentity.ownerEmail))
      .get();

    if (owner === undefined) {
      throw new Error("the owner is missing from the admin database");
    }

    return owner;
  } finally {
    sqlite.close();
  }
}

const CLEAN_DAY = "2026-11-19";
const MISMATCH_DAY = "2026-11-20";

test("the billing overview links to the reconciliation page, which shows the clean and mismatch states", async ({
  page,
  adminIsolatedAppUrl,
  adminIsolatedAppServer,
  accessServer,
}) => {
  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const owner = ownerOf(adminIsolatedAppServer);

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
    day: CLEAN_DAY,
    items: [
      { amountCents: 3500, id: "in_clean_a", result: "matched", userId: owner.id },
      { amountCents: 3500, id: "in_clean_b", result: "matched", userId: owner.id },
    ],
    ledgerGrants: 2,
    ledgerRefunds: 0,
    matched: 2,
    mismatchTotal: 0,
    mismatches: [],
    status: "clean",
    stripeInvoices: 2,
    stripeRefunds: 0,
    unrecorded: 0,
  });

  await page.reload();

  await expect(page.getByText("Clean", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Stripe and Overture records agree for 2026-11-19: 2 paid invoices and 0 refunds.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole("link", { name: copy.admin.billingReconcileOpen }).click();

  await expect(page).toHaveURL(`${adminIsolatedAppUrl}/admin/billing/reconciliation`);
  await expect(page.getByRole("heading", { level: 1, name: "Reconciliation" })).toBeVisible();
  await expect(
    page.getByText("Stripe payments checked against Overture records each day. Last run: 19 Nov.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Billing sections" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconciliation" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByText("Stripe and Overture records agree for 19 Nov", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Review/u })).toHaveCount(0);
  await expect(
    page
      .getByRole("cell", { name: owner.name.length > 0 ? owner.name : owner.email, exact: true })
      .first(),
  ).toBeVisible();

  const clean = await new AxeBuilder({ page }).analyze();

  expect(clean.violations).toEqual([]);

  storeResult(adminIsolatedAppServer, {
    checkedAt: createClock().now(),
    day: MISMATCH_DAY,
    items: [
      { amountCents: 3500, id: "in_matched", result: "matched", userId: owner.id },
      { amountCents: 3500, id: "in_ghost", result: "not_in_overture", userId: null },
      { amountCents: null, id: "in_gone", result: "not_in_stripe", userId: owner.id },
    ],
    ledgerGrants: 2,
    ledgerRefunds: 0,
    matched: 1,
    mismatchTotal: 2,
    mismatches: [
      { amountCents: 3500, id: "in_ghost", kind: "invoice_without_grant" },
      { amountCents: 3500, id: "re_ghost", kind: "refund_without_ledger" },
    ],
    status: "mismatch",
    stripeInvoices: 3,
    stripeRefunds: 1,
    unrecorded: 1,
  });

  await page.reload();

  await expect(page.getByText("2 payments do not match Stripe", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing is changed automatically.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review 2 mismatches" })).toBeVisible();

  const mismatch = await new AxeBuilder({ page }).analyze();

  expect(mismatch.violations).toEqual([]);

  await page.getByRole("button", { name: "Review 2 mismatches" }).click();

  await expect(page.getByText("Showing payments that need a review")).toBeVisible();
  await expect(page.getByRole("cell", { name: "in_matched", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "in_ghost", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show all payments" }).click();

  await expect(page.getByRole("cell", { name: "in_matched", exact: true })).toBeVisible();

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
