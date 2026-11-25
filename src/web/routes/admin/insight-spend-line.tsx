import { formatUsdMicros } from "./llm-format.ts";

export function SpendLine({
  label,
  note,
  micros,
}: {
  label: string;
  note: string;
  micros: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-2.5">
      <span className="min-w-0">
        <span className="block break-words text-sm">{label}</span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
      <span className="font-serif text-base tabular-nums">{formatUsdMicros(micros)}</span>
    </div>
  );
}
