import { copy } from "../../../shared/copy.ts";
import type { BillingReconciliationItem } from "../../lib/admin-api.ts";

const RESULT_TONE = {
  matched: "bg-ok-soft text-ok",
  not_in_overture: "bg-need-soft text-need",
  not_in_stripe: "bg-need-soft text-need",
} as const;

export function ResultPill({ result }: { result: BillingReconciliationItem["result"] }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${RESULT_TONE[result]}`}
    >
      {copy.admin.billingReconcileResults[result]}
    </span>
  );
}
