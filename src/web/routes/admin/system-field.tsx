export function SystemField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-t border-border py-2.5 first:border-t-0">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[13px] font-medium tabular-nums">
        {value}
      </dd>
    </div>
  );
}
