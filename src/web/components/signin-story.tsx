import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { ReceiptHead } from "./receipt-head.tsx";

const pillars = [
  {
    n: copy.signIn.story.pillar01,
    title: copy.signIn.story.pillar01Title,
    detail: copy.signIn.story.pillar01Detail,
  },
  {
    n: copy.signIn.story.pillar02,
    title: copy.signIn.story.pillar02Title,
    detail: copy.signIn.story.pillar02Detail,
  },
  {
    n: copy.signIn.story.pillar03,
    title: copy.signIn.story.pillar03Title,
    detail: copy.signIn.story.pillar03Detail,
  },
];

export function SignInStory() {
  const v = copy.signIn.story;

  return (
    <section
      aria-label={copy.signIn.sampleLabel}
      className="relative hidden min-h-screen flex-col justify-between gap-7 overflow-hidden border-r border-border bg-sidebar px-[max(32px,4.5vw)] pb-9 pt-[34px] min-[961px]:flex"
    >
      <div className="flex items-center gap-2.5">
        <BrandMark size={34} />
        <span className="font-serif text-[29px] leading-none tracking-tight">{copy.app.name}</span>
      </div>
      <div className="mx-auto flex w-full max-w-[610px] flex-col justify-between gap-7">
        <div className="flex flex-col gap-4">
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-input bg-card px-[11px] py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-signal" />
            {v.pill}
          </span>
          <h1 className="font-serif text-[clamp(52px,5vw,76px)] leading-[0.96] tracking-[-0.022em]">
            {v.heading}
            <br />
            <span className="italic">{v.headingItalic}</span>
          </h1>
          <p className="max-w-[45ch] text-[15.5px] leading-[1.62] text-muted-foreground">
            {v.deck}
          </p>
        </div>
        <article
          aria-label={v.receiptAria}
          className="relative mt-1.5 rounded-[12px] border border-input bg-card px-6 pb-[18px] pt-[22px] shadow-lift"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-4 top-0 h-[86px] rounded-[11px] border border-border bg-muted px-4 p-3 opacity-90"
          />
          <div className="relative z-10 rounded-xl bg-card">
            <ReceiptHead meta={v.receiptMeta} monogram={v.receiptMonogram} title={v.receiptTitle} />
            <div className="mt-4 grid grid-cols-[1fr_22px_1.12fr] gap-x-2 border-b border-border pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {v.asksHeading}
              </span>
              <span />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {v.factsHeading}
              </span>
            </div>
            {v.asks.map((ask, index) => (
              <div
                key={ask}
                className="mt-2.5 grid grid-cols-[1fr_22px_1.12fr] items-center gap-x-2"
              >
                <span className="truncate text-[12.5px] text-muted-foreground">{ask}</span>
                <span
                  aria-hidden="true"
                  className="relative h-0 border-t border-dotted border-input"
                >
                  <span className="absolute -right-0.5 -top-[3px] h-[5px] w-[5px] rounded-full bg-foreground" />
                </span>
                <span className="truncate text-[12.5px] font-semibold">{v.facts[index]}</span>
              </div>
            ))}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {v.receiptStamp}
              </span>
              <span className="inline-flex rotate-[-2.5deg] items-center rounded-[4px] border-[1.5px] border-signal px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.16em] text-signal-text">
                {v.stamp}
              </span>
            </div>
          </div>
        </article>
      </div>
      <div className="grid grid-cols-3 gap-4 border-t border-border pt-5 shadow-[0_-1px_0_var(--color-bloom)]">
        {pillars.map((pillar) => (
          <div key={pillar.n} className="flex flex-col gap-[3px]">
            <span className="font-mono text-[11px] text-signal-text">{pillar.n}</span>
            <span className="text-[13px] font-semibold">{pillar.title}</span>
            <span className="text-xs leading-[1.45] text-muted-foreground">{pillar.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
