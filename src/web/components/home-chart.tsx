import { BarChart3, TrendingUp } from "lucide-react";
import { useState } from "react";

import type { HomeRange, HomeRangeKey } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { ChartArea } from "./ui/chart-area.tsx";
import { ChartBar } from "./ui/chart-bar.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { Tabs } from "./ui/tabs.tsx";
import { TabsList } from "./ui/tabs-list.tsx";
import { TabsTrigger } from "./ui/tabs-trigger.tsx";

type ChartStyle = "area" | "bar";

const RANGE_KEYS: readonly HomeRangeKey[] = ["7D", "30D", "90D"];

const RANGE_LABELS: Record<HomeRangeKey, string> = {
  "7D": copy.home.ranges.d7,
  "30D": copy.home.ranges.d30,
  "90D": copy.home.ranges.d90,
};

function isRangeKey(value: string): value is HomeRangeKey {
  return value === "7D" || value === "30D" || value === "90D";
}

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

  return (
    <Card ariaLabelledBy="home-chart" className="mt-5 flex flex-col p-5 md:p-6">
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
          <Tabs
            onValueChange={(value) => {
              if (value === "area" || value === "bar") {
                setChartStyle(value);
              }
            }}
            value={chartStyle}
          >
            <TabsList ariaLabel={copy.home.chart.styleLabel}>
              <TabsTrigger className="gap-1.5 px-2.5" value="area">
                <TrendingUp aria-hidden="true" size={14} />
                <span>{copy.home.chart.areaLabel}</span>
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 px-2.5" value="bar">
                <BarChart3 aria-hidden="true" size={14} />
                <span>{copy.home.chart.barLabel}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs
            onValueChange={(value) => {
              if (isRangeKey(value)) {
                onRangeChange(value);
              }
            }}
            value={rangeKey}
          >
            <TabsList ariaLabel={copy.home.rangeLabel}>
              {RANGE_KEYS.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {RANGE_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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
