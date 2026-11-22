export function BillingStatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sh">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-[34px] leading-none tabular-nums">{value}</p>
      <p className="mt-2 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}
