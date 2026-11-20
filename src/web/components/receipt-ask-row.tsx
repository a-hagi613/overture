export function ReceiptRow({ ask, fact }: { ask: string; fact: string }) {
  return (
    <div className="grid grid-cols-[1fr_22px_1.12fr] items-center gap-x-2">
      <span className="truncate text-[12.5px] text-muted-foreground">{ask}</span>
      <span aria-hidden="true" className="relative h-0 border-t border-dotted border-input">
        <span className="absolute -right-0.5 -top-[3px] h-[5px] w-[5px] rounded-full bg-foreground" />
      </span>
      <span className="truncate text-[12.5px] font-semibold">{fact}</span>
    </div>
  );
}
