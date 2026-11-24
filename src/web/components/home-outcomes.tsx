import type { HomeRange, HomeRangeKey } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import {
  HOME_RANGE_KEYS,
  HOME_RANGE_LABELS,
  isHomeRangeKey,
  rangeDays,
} from "../lib/home-bands.ts";
import { cn } from "./ui/cn.ts";
import { dsCard, dsCardTitle, dsMetric } from "./ui/ds.ts";
import { SegmentedControl } from "./ui/segmented-control.tsx";
import { SegmentedControlItem } from "./ui/segmented-control-item.tsx";

function deltaTone(delta: number) {
  if (delta > 0) {
    return "text-ok";
  }

  return delta < 0 ? "text-need" : "text-muted-foreground";
}

export function HomeOutcomes(props: {
  onRangeChange: (next: HomeRangeKey) => void;
  range: HomeRange;
  rangeKey: HomeRangeKey;
}) {
  const { onRangeChange, range, rangeKey } = props;

  const metrics = [
    {
      detail: copy.home.sentDelta(range.sentDelta, rangeDays(rangeKey)),
      label: copy.home.kpi.sent,
      tone: deltaTone(range.sentDelta),
      value: range.applicationsSent,
    },
    { detail: null, label: copy.home.outcomes.replies, tone: "", value: range.replies },
    {
      detail: null,
      label: copy.home.outcomes.interviews,
      tone: "",
      value: range.interviewsBooked,
    },
  ];

  return (
    <section aria-labelledby="home-outcomes-title" className="mt-5" data-testid="home-outcomes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={dsCardTitle} id="home-outcomes-title">
          {copy.home.daySoFar}
        </h2>
        <SegmentedControl
          ariaLabel={copy.home.rangeLabel}
          onValueChange={(value) => {
            if (isHomeRangeKey(value)) {
              onRangeChange(value);
            }
          }}
          value={rangeKey}
        >
          {HOME_RANGE_KEYS.map((key) => (
            <SegmentedControlItem key={key} value={key}>
              {HOME_RANGE_LABELS[key]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div className={cn(dsCard, "p-5")} key={metric.label}>
            <dt className="text-xs font-medium text-muted-foreground">{metric.label}</dt>
            <dd className={`${dsMetric} mt-2`}>{String(metric.value)}</dd>
            {metric.detail === null ? null : (
              <dd className={`mt-2 text-xs leading-relaxed ${metric.tone}`}>{metric.detail}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
