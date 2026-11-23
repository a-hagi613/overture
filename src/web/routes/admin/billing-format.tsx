import { billingStateLabel } from "./billing-labels.ts";
import type { BillingStateKey } from "./billing-labels.ts";

const tones: Record<BillingStateKey, string> = {
  ending: "bg-signal-soft text-signal-text",
  ended: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
  paused: "bg-need-soft text-need",
  paying: "bg-ok-soft text-ok",
  trial: "bg-muted text-muted-foreground",
};

export function BillingStatePill({ state }: { state: BillingStateKey }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${tones[state]}`}
    >
      {billingStateLabel(state)}
    </span>
  );
}
