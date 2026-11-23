import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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

  return (
    <figure aria-label={ariaLabel} className={cn("m-0 h-56 w-full", className)}>
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={chartData} margin={{ bottom: 4, left: -18, right: 8, top: 10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--color-signal)" stopOpacity={0.28} />
              <stop offset="95%" stopColor="var(--color-signal)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={24}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
            tickLine={false}
          />
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
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            stroke="var(--color-signal)"
            strokeWidth={2.25}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
