export function AccountRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[12.5px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
