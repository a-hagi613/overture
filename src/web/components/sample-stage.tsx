import { copy } from "../../shared/copy.ts";
import { CompanyBrandTile } from "./landing/company-brands.tsx";
import { ReceiptHead } from "./receipt-head.tsx";
import { ReceiptRow } from "./receipt-ask-row.tsx";

export function SampleStage() {
  const v = copy.signIn.story;

  return (
    <div className="relative mt-2 pt-12">
      <div
        aria-hidden="true"
        className="absolute inset-x-4 top-0 flex h-20 -rotate-1 items-start justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-2.5 opacity-90"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <CompanyBrandTile brandKey="airCanada" size="sm" />
          <span className="truncate text-xs font-semibold text-muted-foreground">
            {v.backdropRole}
          </span>
        </div>
        <span className="flex-none font-mono text-xs text-muted-foreground">{v.backdropQueue}</span>
      </div>
      <article
        aria-label={v.receiptAria}
        className="relative rounded-xl border border-input bg-card px-6 py-5 shadow-lift"
      >
        <ReceiptHead brandKey="stripe" meta={v.receiptMeta} title={v.receiptTitle} />
        <div className="mt-4 grid grid-cols-[1fr_24px_1.12fr] gap-x-2 border-b border-border pb-1.5">
          <span className="text-eyebrow font-semibold uppercase text-muted-foreground">
            {v.asksHeading}
          </span>
          <span aria-hidden="true" />
          <span className="text-eyebrow font-semibold uppercase text-muted-foreground">
            {v.factsHeading}
          </span>
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          {v.asks.map((ask, index) => (
            <ReceiptRow ask={ask} fact={v.facts[index] ?? ""} key={ask} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {v.receiptStamp}
          </span>
          <span className="inline-flex -rotate-2 items-center rounded border-2 border-double border-signal px-2.5 py-0.5 text-eyebrow font-bold uppercase text-signal-text">
            {v.stamp}
          </span>
        </div>
      </article>
    </div>
  );
}
