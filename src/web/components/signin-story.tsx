import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { SampleStage } from "./sample-stage.tsx";

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
      className="relative hidden overflow-hidden border-r border-border bg-sidebar px-[clamp(32px,4.5vw,64px)] pb-9 pt-[34px] shadow-[1px_0_0_var(--color-bloom)] min-[961px]:flex min-[961px]:flex-col"
    >
      <div className="relative z-[1] mx-auto flex h-full w-full max-w-[610px] flex-col justify-between gap-7">
        <div className="flex items-center gap-4">
          <Link
            aria-label={copy.brand.homeAria}
            className="inline-flex items-center gap-[11px]"
            to="/"
          >
            <BrandMark size={34} />
            <span className="font-serif text-[29px] leading-none">{copy.app.name}</span>
          </Link>
        </div>
        <div className="flex flex-col gap-4">
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-input bg-card px-[11px] py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground [line-height:normal]">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-signal" />
            {v.pill}
          </span>
          <h1 className="font-serif font-serif-display text-[clamp(52px,5vw,76px)] leading-[0.96]">
            {v.heading}
            <br />
            <span className="italic">{v.headingItalic}</span>
          </h1>
          <p className="max-w-[45ch] text-[15.5px] leading-[1.62] text-muted-foreground">
            {v.deck}
          </p>
          <SampleStage />
        </div>
        <div className="grid grid-cols-3 gap-4 border-t border-border pt-5 shadow-[0_-1px_0_var(--color-bloom)]">
          {pillars.map((pillar) => (
            <div key={pillar.n} className="flex flex-col gap-[3px]">
              <span className="font-mono text-[11px] text-signal-text [line-height:normal]">
                {pillar.n}
              </span>
              <span className="text-[13px] font-semibold [line-height:normal]">{pillar.title}</span>
              <span className="text-xs leading-[1.45] text-muted-foreground">{pillar.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
