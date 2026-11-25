import { ArrowUpRight, Check, ExternalLink } from "lucide-react";

import type { BillingPlan } from "../lib/billing-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsEyebrow, dsMetric } from "./ui/ds.ts";

export interface BillingUpgradeOption {
  bullets: readonly string[];
  featured: boolean;
  id: BillingPlan;
  name: string;
  per: string;
  price: string;
  title: string;
}

export function BillingUpgradeCard({
  busy,
  disabled,
  onSelect,
  option,
  switchInStripe,
}: {
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
  option: BillingUpgradeOption;
  switchInStripe: boolean;
}) {
  const bp = copy.nav.profilePages;
  const headingId = `billing-upgrade-${option.id}-heading`;

  const bulletList = (
    <ul className="mt-4 flex list-none flex-col gap-2.5 p-0 text-sm text-foreground">
      {option.bullets.map((bullet) => (
        <li className="flex items-start gap-2.5" key={bullet}>
          <Check aria-hidden="true" className="mt-0.5 shrink-0 text-signal-text" size={15} />
          <span>{bullet}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <Card ariaLabelledBy={headingId} className={option.featured ? "border-signal/60 p-6" : "p-6"}>
      <div className="flex h-full flex-col justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className={dsEyebrow}>{bp.billingUpgradeEyebrow}</p>
            {option.featured ? <Badge variant="signal">{bp.billingPopularBadge}</Badge> : null}
          </div>
          <h2 className={`${dsCardTitle} mt-1.5`} id={headingId}>
            {option.title}
          </h2>
          <div className="mt-3 flex items-baseline gap-1.5 tabular-nums">
            <span className={dsMetric}>{option.price}</span>
            <span className="text-sm text-muted-foreground">{option.per}</span>
          </div>
          {bulletList}
        </div>
        <div>
          <Button
            ariaBusy={busy}
            className="w-full sm:w-auto"
            disabled={disabled}
            onClick={onSelect}
            size="lg"
            variant={option.featured ? "primary" : "secondary"}
          >
            <span>{bp.billingUpgradeAction(option.name)}</span>
            {switchInStripe ? (
              <ExternalLink aria-hidden="true" size={16} />
            ) : (
              <ArrowUpRight aria-hidden="true" size={16} />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
