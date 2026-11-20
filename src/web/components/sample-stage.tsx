import { copy } from "../../shared/copy.ts";
import { ReceiptHead } from "./receipt-head.tsx";
import { ReceiptRow } from "./receipt-ask-row.tsx";

export function SampleStage() {
  const v = copy.signIn.story;

  return (
    <div className="relative mt-1.5 pt-[42px]">
      <div
        aria-hidden="true"
        className="absolute inset-x-4 top-0 flex h-[86px] -rotate-[1.2deg] items-start justify-between gap-3 rounded-[11px] border border-border bg-muted p-3 px-4 opacity-[0.92]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md bg-foreground font-serif text-lg italic text-background">
            {v.backdropMonogram}
          </span>
          <span className="text-[13px] font-semibold [line-height:normal]">{v.backdropRole}</span>
        </div>
        <span className="font-mono text-[12.5px] text-muted-foreground [line-height:normal]">
          {v.backdropQueue}
        </span>
      </div>
      <article
        aria-label={v.receiptAria}
        className="relative rounded-[12px] border border-input bg-card px-6 pb-[18px] pt-[22px] shadow-lift"
      >
        <ReceiptHead meta={v.receiptMeta} monogram={v.receiptMonogram} title={v.receiptTitle} />
        <div className="mt-4 grid grid-cols-[1fr_22px_1.12fr] gap-x-2 border-b border-border pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [line-height:normal]">
            {v.asksHeading}
          </span>
          <span aria-hidden="true" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground [line-height:normal]">
            {v.factsHeading}
          </span>
        </div>
        <div className="mt-2.5 flex flex-col gap-[9px]">
          {v.asks.map((ask, index) => (
            <ReceiptRow ask={ask} fact={v.facts[index] ?? ""} key={ask} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {v.receiptStamp}
          </span>
          <span className="inline-flex rotate-[-2.5deg] items-center rounded-[4px] border-[1.5px] border-signal px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.16em] text-signal-text [line-height:normal]">
            {v.stamp}
          </span>
        </div>
      </article>
    </div>
  );
}
