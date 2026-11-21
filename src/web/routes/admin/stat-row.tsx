export function AdminStatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <span className="text-[13px]">{label}</span>
      <span className="font-serif text-[20px] tabular-nums">{value}</span>
    </div>
  );
}
