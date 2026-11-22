import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Payments } from "../platform/ports/payments.ts";

import { adminAudit, grants } from "../platform/db/schema.ts";
import { NoRefundablePaymentError } from "../platform/ports/payments.ts";
import type { AdminAuditRow } from "../platform/audit/index.ts";
import { insertAdminAudit } from "../platform/audit/insert.ts";
import { refundGrantApplications } from "./ledger.ts";

export const REFUND_AUDIT_ACTION = "billing.refund";

export const REFUND_REASONS = [
  "charged_twice",
  "not_received",
  "wrong_plan",
  "goodwill",
  "other",
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

export interface RefundRecord {
  refundId: string;
  grantId: string;
  amountCents: number;
  status: string;
  applicationsStopped: number;
}

export interface RefundInput {
  actorId: string;
  grantId: string;
  amountCents: number | null;
  reason: RefundReason;
  note: string;
  idempotencyKey: string;
}

const refundDetailSchema = z.object({
  amountCents: z.number(),
  applicationsStopped: z.number(),
  grantId: z.string(),
  refundId: z.string(),
  refundKey: z.string(),
  requestHash: z.string(),
  status: z.string(),
});

type RefundDetail = z.infer<typeof refundDetailSchema>;

function refundDetailsOf(db: Pick<AppDatabase, "select">) {
  return db
    .select({ detail: adminAudit.detail })
    .from(adminAudit)
    .where(eq(adminAudit.action, REFUND_AUDIT_ACTION))
    .all()
    .flatMap((row) => {
      const parsed = refundDetailSchema.safeParse(JSON.parse(row.detail));

      return parsed.success ? [parsed.data] : [];
    });
}

export function refundRequestHash(input: {
  grantId: string;
  amountCents: number | null;
  reason: RefundReason;
}) {
  return JSON.stringify([input.grantId, input.amountCents, input.reason]);
}

function recordOf(detail: RefundDetail) {
  return {
    amountCents: detail.amountCents,
    applicationsStopped: detail.applicationsStopped,
    grantId: detail.grantId,
    refundId: detail.refundId,
    status: detail.status,
  };
}

/**
 * Refunds the payment behind a paid grant, at Stripe and in Overture's ledger,
 * and records it in the admin audit log.
 *
 * Stripe receives one idempotency key per grant, so two requests for the same
 * grant (a double click, a retry, or two different request keys) can never
 * refund the payment twice. The request key makes a replay return the first
 * refund unchanged without calling Stripe again.
 * @param deps The database, clock, payments port and audit sink.
 * @param input The grant, the amount, the reason and the admin's note.
 * @returns What happened: a refund, a replay, or the reason it was refused.
 */
export async function refundGrant(
  deps: {
    db: AppDatabase;
    clock: Clock;
    payments: Payments;
    shipAudit: (row: AdminAuditRow) => Promise<void>;
  },
  input: RefundInput,
) {
  const { db, clock, payments, shipAudit } = deps;
  const refundKey = `refund:${input.idempotencyKey}`;
  const requestHash = refundRequestHash(input);

  const replay = refundDetailsOf(db).find((detail) => detail.refundKey === refundKey);

  if (replay !== undefined) {
    if (replay.requestHash !== requestHash) {
      return { kind: "idempotency_key_reused" } as const;
    }

    return { kind: "refunded", refund: recordOf(replay), replayed: true } as const;
  }

  const grant = db.select().from(grants).where(eq(grants.id, input.grantId)).get();

  if (grant === undefined) {
    return { kind: "not_found" } as const;
  }

  if (grant.stripeInvoiceId === null || grant.source !== "period") {
    return { kind: "not_refundable" } as const;
  }

  if (refundDetailsOf(db).some((detail) => detail.grantId === grant.id)) {
    return { kind: "already_refunded" } as const;
  }

  let refund;

  try {
    refund = await payments.refundInvoice({
      amountCents: input.amountCents,
      idempotencyKey: `refund-grant:${grant.id}`,
      invoiceId: grant.stripeInvoiceId,
    });
  } catch (error) {
    if (error instanceof NoRefundablePaymentError) {
      return { kind: "no_stripe_payment" } as const;
    }

    throw error;
  }

  const outcome = db.transaction((tx) => {
    const alreadyRecorded = refundDetailsOf(tx).some((detail) => detail.grantId === grant.id);

    if (alreadyRecorded) {
      return { kind: "already_refunded" } as const;
    }

    const row = refundGrantApplications(tx, clock, {
      grantId: grant.id,
      idempotencyKey: refundKey,
      userId: grant.userId,
    });

    const stopped: RefundRecord = {
      amountCents: refund.amountCents,
      applicationsStopped: row === null ? 0 : row.amount,
      grantId: grant.id,
      refundId: refund.id,
      status: refund.status,
    };

    const stored = insertAdminAudit(tx, clock, {
      actorId: input.actorId,
      action: REFUND_AUDIT_ACTION,
      detail: {
        amountCents: stopped.amountCents,
        applicationsStopped: stopped.applicationsStopped,
        grantId: stopped.grantId,
        note: input.note,
        reason: input.reason,
        refundId: stopped.refundId,
        refundKey,
        requestHash,
        status: stopped.status,
      },
      reason: `Refunded ${String(stopped.amountCents)} cents: ${input.reason}`,
      targetUserId: grant.userId,
    });

    return { auditRow: stored, kind: "refunded", record: stopped } as const;
  });

  if (outcome.kind === "already_refunded") {
    return outcome;
  }

  await shipAudit(outcome.auditRow);

  return { kind: "refunded", refund: outcome.record, replayed: false } as const;
}
