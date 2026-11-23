export function SystemStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-serif text-[20px] leading-tight tabular-nums">
        {value}
      </dd>
    </div>
  );
}
