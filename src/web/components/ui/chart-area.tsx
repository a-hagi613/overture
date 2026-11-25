import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip } from "./chart-tooltip.tsx";
import { cn } from "./cn.ts";

export interface AreaChartDatum {
  label: string;
  value: number;
}

export function ChartArea({
  ariaLabel,
  className,
  data,
  unitLabel,
}: {
  ariaLabel: string;
  className?: string;
  data: readonly AreaChartDatum[];
  unitLabel: string;
}) {
  const gradientId = `ov-area-${useId().replaceAll(":", "")}`;
  const chartData = [...data];
  let maxValue = 0;
  let total = 0;

  for (const entry of chartData) {
    if (entry.value > maxValue) {
      maxValue = entry.value;
    }

    total += entry.value;
  }

  const yMax = Math.max(2, Math.ceil(maxValue * 1.25));
  const average = chartData.length > 0 ? total / chartData.length : 0;

  return (
    <figure aria-label={ariaLabel} className={cn("relative m-0 min-h-40 w-full flex-1", className)}>
      <div className="absolute inset-0">
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={chartData} margin={{ bottom: 4, left: 0, right: 12, top: 12 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="var(--color-signal)" stopOpacity={0.28} />
                <stop offset="95%" stopColor="var(--color-signal)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeOpacity={0.6}
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={24}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              domain={[0, yMax]}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              tickLine={false}
              tickMargin={8}
              width={32}
            />
            {average > 0 ? (
              <ReferenceLine
                stroke="var(--color-muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity={0.45}
                y={average}
              />
            ) : null}
            <Tooltip
              content={<ChartTooltip unitLabel={unitLabel} />}
              cursor={{ stroke: "var(--color-input)", strokeDasharray: "4 4", strokeWidth: 1 }}
            />
            <Area
              activeDot={{
                fill: "var(--color-card)",
                r: 5,
                stroke: "var(--color-signal)",
                strokeWidth: 2.5,
              }}
              dataKey="value"
              dot={
                chartData.length <= 31
                  ? {
                      fill: "var(--color-card)",
                      r: 3.5,
                      stroke: "var(--color-signal)",
                      strokeWidth: 2,
                    }
                  : false
              }
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              stroke="var(--color-signal)"
              strokeWidth={2.25}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
