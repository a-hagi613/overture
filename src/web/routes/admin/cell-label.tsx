export function AdminCellLabel({ label }: { label: string }) {
  return (
    <span className="mb-1 block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground md:sr-only">
      {label}
    </span>
  );
}
