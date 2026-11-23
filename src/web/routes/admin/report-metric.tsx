const labelClass = "text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground";

export function ReportMetric(props: { label: string; value: string }) {
  return (
    <div>
      <dt className={labelClass}>{props.label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{props.value}</dd>
    </div>
  );
}
