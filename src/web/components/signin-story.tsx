import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { LandingHeroStack } from "./landing/landing-hero-stack.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsBody, dsCardTitle, dsLead } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";

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
      className="relative hidden overflow-hidden border-r border-border bg-sidebar px-10 py-9 lg:flex lg:flex-col xl:px-14"
    >
      <div className="relative z-10 mx-auto flex h-full w-full max-w-xl flex-col justify-between gap-7">
        <div className="flex items-center gap-4">
          <Link
            aria-label={copy.brand.homeAria}
            className="inline-flex items-center gap-2.5 transition hover:opacity-80"
            to="/"
          >
            <BrandMark size={32} />
            <span className={dsCardTitle}>{copy.app.name}</span>
          </Link>
        </div>
        <div className="flex flex-col gap-5">
          <Badge className="self-start" size="eyebrow" variant="signal">
            {v.pill}
          </Badge>
          <p className="font-serif text-hero font-normal text-foreground">
            {v.heading}
            <br />
            <em className="italic text-signal">{v.headingItalic}</em>
          </p>
          <p className={`${dsLead} max-w-md`}>{v.deck}</p>
          <div className="pt-1">
            <LandingHeroStack compact />
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <Separator />
          <div className="grid grid-cols-3 gap-5">
            {pillars.map((pillar) => (
              <div className="flex flex-col gap-1" key={pillar.n}>
                <span className="font-mono text-xs text-signal-text">{pillar.n}</span>
                <span className="text-sm font-semibold text-foreground">{pillar.title}</span>
                <span className={`${dsBody} text-xs`}>{pillar.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
