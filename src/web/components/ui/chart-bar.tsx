import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
          <BarChart data={chartData} margin={{ bottom: 4, left: 0, right: 12, top: 12 }}>
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
              minTickGap={16}
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
      </div>
    </figure>
  );
}
