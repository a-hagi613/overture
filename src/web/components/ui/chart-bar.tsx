import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartTooltip } from "./chart-tooltip.tsx";
import { cn } from "./cn.ts";

export interface BarChartDatum {
  label: string;
  value: number;
}

export function ChartBar({
  ariaLabel,
  className,
  data,
  unitLabel,
}: {
  ariaLabel: string;
  className?: string;
  data: readonly BarChartDatum[];
  unitLabel: string;
}) {
  const chartData = [...data];

  return (
    <figure aria-label={ariaLabel} className={cn("m-0 h-64 w-full", className)}>
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={chartData} margin={{ bottom: 4, left: -18, right: 8, top: 10 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={16}
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
            cursor={{ fill: "var(--color-muted)", opacity: 0.45 }}
          />
          <Bar
            dataKey="value"
            fill="var(--color-signal)"
            isAnimationActive={false}
            maxBarSize={44}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
