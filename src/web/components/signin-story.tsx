import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { LandingHeroStack } from "./landing/landing-hero-stack.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsBody, dsCardTitle, dsLead } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";

export function SignInStory({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const v = mode === "signup" ? copy.signIn.signUpStory : copy.signIn.story;

  const pillars = [
    {
      n: v.pillar01,
      title: v.pillar01Title,
      detail: v.pillar01Detail,
    },
    {
      n: v.pillar02,
      title: v.pillar02Title,
      detail: v.pillar02Detail,
    },
    {
      n: v.pillar03,
      title: v.pillar03Title,
      detail: v.pillar03Detail,
    },
  ];

  return (
    <section
      aria-label={copy.signIn.sampleLabel}
      className="relative hidden overflow-hidden border-r border-border bg-sidebar px-8 py-5 lg:flex lg:flex-col xl:px-10 xl:py-6"
    >
      <div className="relative z-10 mx-auto flex h-full w-full max-w-2xl flex-col justify-between gap-4">
        <div className="flex items-center justify-between gap-4">
          <Link
            aria-label={copy.brand.homeAria}
            className="inline-flex items-center gap-2.5 transition hover:opacity-80"
            to="/"
          >
            <BrandMark size={32} />
            <span className={dsCardTitle}>{copy.app.name}</span>
          </Link>
          <Badge size="eyebrow" variant="signal">
            {v.pill}
          </Badge>
        </div>
        <div className="flex flex-col gap-3">
          <p className="font-serif text-page-title font-normal text-foreground">
            {v.heading} <em className="italic text-signal">{v.headingItalic}</em>
          </p>
          <p className={`${dsLead} max-w-xl`}>{v.deck}</p>
          <div className="pt-1">
            <LandingHeroStack surface="sidebar" />
          </div>
        </div>
        <div className="flex flex-col gap-3.5">
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
