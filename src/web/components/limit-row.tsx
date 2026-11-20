export function LimitRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <span className="flex-none font-mono tabular-nums text-[13px] font-semibold">{label}</span>
      <span className="text-[12.5px] text-muted-foreground">{detail}</span>
    </div>
  );
}
