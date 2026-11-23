export interface ChartTooltipItem {
  value?: number | string;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  payload?: readonly ChartTooltipItem[];
  unitLabel: string;
}

export function ChartTooltip({ active, label, payload, unitLabel }: ChartTooltipProps) {
  const first = payload?.[0];

  if (active !== true || first === undefined) {
    return null;
  }

  return (
    <div className="rounded-lg border border-input bg-card px-3 py-2 shadow-lift">
      <p className="font-mono text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-foreground tabular-nums">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-signal" />
        <span>{String(first.value ?? 0)}</span>
        <span className="font-normal text-muted-foreground">{unitLabel}</span>
      </div>
    </div>
  );
}
