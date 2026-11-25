import { BarChart3, TrendingUp } from "lucide-react";
import { useState } from "react";

import type { HomeRange, HomeRangeKey } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { HOME_RANGE_KEYS, HOME_RANGE_LABELS, isHomeRangeKey } from "../lib/home-bands.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { ChartArea } from "./ui/chart-area.tsx";
import { ChartBar } from "./ui/chart-bar.tsx";
import { dsMetric } from "./ui/ds.ts";
import { PanelHeader } from "./ui/panel-header.tsx";
import { SegmentedControl } from "./ui/segmented-control.tsx";
import { SegmentedControlItem } from "./ui/segmented-control-item.tsx";

type ChartStyle = "area" | "bar";

function subtitleFor(rangeKey: HomeRangeKey) {
  if (rangeKey === "30D") {
    return copy.home.chart.perDay30;
  }

  if (rangeKey === "90D") {
    return copy.home.chart.perWeek90;
  }

  return copy.home.chart.perDay7;
}

function cadenceFor(rangeKey: HomeRangeKey) {
  return rangeKey === "90D" ? copy.home.chart.cadenceWeekly : copy.home.chart.cadenceDaily;
}

function deltaBadgeVariant(delta: number) {
  if (delta > 0) {
    return "ok" as const;
  }

  return delta < 0 ? ("need" as const) : ("secondary" as const);
}

function signedDelta(delta: number) {
  if (delta > 0) {
    return `+${String(delta)}`;
  }

  return delta < 0 ? `−${String(Math.abs(delta))}` : "0";
}

function formatPointLabel(at: number, rangeKey: HomeRangeKey) {
  const date = new Date(at);

  if (rangeKey === "7D") {
    return new Intl.DateTimeFormat(copy.home.dateLocale, { weekday: "short" }).format(date);
  }

  return new Intl.DateTimeFormat(copy.home.dateLocale, { day: "numeric", month: "short" }).format(
    date,
  );
}

function findPeakPoint(points: readonly { label: string; value: number }[]) {
  let best: { label: string; value: number } | null = null;

  for (const point of points) {
    if (best === null || point.value > best.value) {
      best = point;
    }
  }

  return best;
}

export function HomeChart(props: {
  onRangeChange: (next: HomeRangeKey) => void;
  range: HomeRange;
  rangeKey: HomeRangeKey;
}) {
  const { onRangeChange, range, rangeKey } = props;
  const [chartStyle, setChartStyle] = useState<ChartStyle>("area");
  const total = range.chart.points.reduce((sum, point) => sum + point.count, 0);
  const subtitle = subtitleFor(rangeKey);

  const chartData = range.chart.points.map((point, index) => ({
    label: range.chart.labels[index] ?? formatPointLabel(point.at, rangeKey),
    value: point.count,
  }));

  const averageValue = chartData.length > 0 ? total / chartData.length : 0;
  const averageText = chartData.length > 0 ? averageValue.toFixed(1) : "0";
  const peakPoint = findPeakPoint(chartData);

  const controls = (
    <>
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
      <SegmentedControl
        ariaLabel={copy.home.chart.styleLabel}
        onValueChange={(value) => {
          if (value === "area" || value === "bar") {
            setChartStyle(value);
          }
        }}
        value={chartStyle}
      >
        <SegmentedControlItem className="gap-1.5 px-2.5" value="area">
          <TrendingUp aria-hidden="true" size={14} />
          <span>{copy.home.chart.areaLabel}</span>
        </SegmentedControlItem>
        <SegmentedControlItem className="gap-1.5 px-2.5" value="bar">
          <BarChart3 aria-hidden="true" size={14} />
          <span>{copy.home.chart.barLabel}</span>
        </SegmentedControlItem>
      </SegmentedControl>
    </>
  );

  return (
    <Card
      ariaLabelledBy="home-chart"
      className="mt-3 flex min-h-52 flex-1 flex-col overflow-hidden"
      dataTestId="home-chart"
    >
      <PanelHeader
        action={controls}
        className="py-2.5"
        title={copy.home.chart.title}
        titleId="home-chart"
      />

      <div className="flex flex-1 flex-col px-4 py-3 sm:px-5 sm:py-3.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className={dsMetric}>{String(range.applicationsSent)}</span>
            <span className="text-sm font-medium text-muted-foreground">
              {copy.home.chart.applicationsLabel(range.applicationsSent)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="tabular-nums" variant={deltaBadgeVariant(range.sentDelta)}>
              {signedDelta(range.sentDelta)}
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">
              {cadenceFor(rangeKey)}
            </span>
          </div>
        </div>
        {chartStyle === "area" ? (
          <ChartArea
            ariaLabel={copy.home.chart.aria(subtitle, total)}
            className="min-h-36 flex-1 max-md:min-h-56"
            data={chartData}
            unitLabel={copy.home.chart.unit}
          />
        ) : (
          <ChartBar
            ariaLabel={copy.home.chart.aria(subtitle, total)}
            className="min-h-36 flex-1 max-md:min-h-56"
            data={chartData}
            unitLabel={copy.home.chart.unit}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground tabular-nums sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {rangeKey === "90D"
              ? copy.home.chart.avgWeekly(averageText)
              : copy.home.chart.avgDaily(averageText)}
          </span>
          {peakPoint === null || peakPoint.value === 0 ? null : (
            <span>{copy.home.chart.peakLabel(peakPoint.value, peakPoint.label)}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{copy.home.chart.repliesCount(range.replies)}</span>
          <span>{copy.home.chart.interviewsCount(range.interviewsBooked)}</span>
        </div>
      </div>
    </Card>
  );
}
