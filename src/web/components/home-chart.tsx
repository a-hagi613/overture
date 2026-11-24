import { BarChart3, TrendingUp } from "lucide-react";
import { useState } from "react";

import type { HomeRange, HomeRangeKey } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { ChartArea } from "./ui/chart-area.tsx";
import { ChartBar } from "./ui/chart-bar.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
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

function formatPointLabel(at: number, rangeKey: HomeRangeKey) {
  const date = new Date(at);

  if (rangeKey === "7D") {
    return new Intl.DateTimeFormat(copy.home.dateLocale, { weekday: "short" }).format(date);
  }

  return new Intl.DateTimeFormat(copy.home.dateLocale, { day: "numeric", month: "short" }).format(
    date,
  );
}

export function HomeChart(props: { range: HomeRange; rangeKey: HomeRangeKey }) {
  const { range, rangeKey } = props;
  const [chartStyle, setChartStyle] = useState<ChartStyle>("area");
  const total = range.chart.points.reduce((sum, point) => sum + point.count, 0);
  const subtitle = subtitleFor(rangeKey);

  const chartData = range.chart.points.map((point, index) => ({
    label: range.chart.labels[index] ?? formatPointLabel(point.at, rangeKey),
    value: point.count,
  }));

  return (
    <Card
      ariaLabelledBy="home-chart"
      className="mt-5 flex flex-col p-5 md:p-6"
      dataTestId="home-chart"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className={dsCardTitle} id="home-chart">
              {copy.home.chart.title}
            </h2>
            <Badge className="tabular-nums" variant="signal">
              {copy.home.chart.totalBadge(total)}
            </Badge>
          </div>
          <p className={`${dsBody} mt-0.5 text-xs`}>{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      <div className="mt-5">
        {chartStyle === "area" ? (
          <ChartArea
            ariaLabel={copy.home.chart.aria(subtitle, total)}
            className="h-64"
            data={chartData}
            unitLabel={copy.home.chart.unit}
          />
        ) : (
          <ChartBar
            ariaLabel={copy.home.chart.aria(subtitle, total)}
            data={chartData}
            unitLabel={copy.home.chart.unit}
          />
        )}
      </div>
    </Card>
  );
}
