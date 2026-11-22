const labelClass = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

export function ReportMetric(props: { label: string; value: string }) {
  return (
    <div>
      <dt className={labelClass}>{props.label}</dt>
      <dd className="mt-0.5 font-mono text-[13px] tabular-nums">{props.value}</dd>
    </div>
  );
}
