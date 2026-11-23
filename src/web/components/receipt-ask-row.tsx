export function ReceiptRow({ ask, fact }: { ask: string; fact: string }) {
  return (
    <div className="grid grid-cols-[1fr_24px_1.12fr] items-center gap-x-2">
      <span className="truncate text-xs text-muted-foreground">{ask}</span>
      <span aria-hidden="true" className="relative h-0 border-t border-dotted border-input">
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-ok" />
      </span>
      <span className="truncate text-xs font-semibold text-foreground">{fact}</span>
    </div>
  );
}
