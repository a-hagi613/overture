import { useEffect, useState } from "react";

import { Badge } from "../ui/badge.tsx";
import { dsContainer, dsSectionHeading } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";
import { LandingStepAppliedCard } from "./landing-step-applied-card.tsx";
import { LandingStepFeedCard } from "./landing-step-feed-card.tsx";
import { LandingStepMatchCard } from "./landing-step-match-card.tsx";
import { LandingStepNode } from "./landing-step-node.tsx";

interface PathSeg {
  dir: "r" | "l" | "d";
  id: string;
  leg: number;
  orientation: "h" | "v";
  style: { height?: string; left: string; top: string; width?: string };
}

const gutterPath: readonly PathSeg[] = [
  {
    dir: "r",
    id: "p1",
    leg: 0,
    orientation: "h",
    style: { left: "calc(0% + 26px)", top: "24px", width: "calc(50% + 15px)" },
  },
  {
    dir: "r",
    id: "p2a",
    leg: 1,
    orientation: "h",
    style: { left: "calc(50% + 41px)", top: "24px", width: "calc(50% - 27px)" },
  },
  {
    dir: "d",
    id: "p2b",
    leg: 1,
    orientation: "v",
    style: { height: "404px", left: "calc(100% + 14px)", top: "24px" },
  },
  {
    dir: "l",
    id: "p2c",
    leg: 1,
    orientation: "h",
    style: { left: "calc(50% + 41px)", top: "428px", width: "calc(50% - 27px)" },
  },
];

function dotAnimClass(dir: PathSeg["dir"], lit: boolean) {
  if (!lit) {
    return "opacity-0";
  }

  if (dir === "r") {
    return "animate-seg-r";
  }

  if (dir === "l") {
    return "animate-seg-l";
  }

  return "animate-seg-d";
}

const STEP_COUNT = 3;
const STEP_INTERVAL_MS = 3200;

export function LandingHowItWorks() {
  const [activeStep, setActiveStep] = useState(0);
  const [hoverStep, setHoverStep] = useState<number | null>(null);

  useEffect(() => {
    const stepTimer = globalThis.setInterval(() => {
      setActiveStep((current) => (current + 1) % STEP_COUNT);
    }, STEP_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(stepTimer);
    };
  }, []);

  const current = hoverStep ?? activeStep;

  return (
    <section
      aria-labelledby="how-it-works-title"
      className={`${dsContainer} pb-14 pt-12 sm:pb-20 sm:pt-16`}
      id="how-it-works"
    >
      <div className="mx-auto max-w-2xl text-center">
        <Badge size="eyebrow" variant="signal">
          {LANDING_COPY.howItWorks.badge}
        </Badge>
        <h2 className={`${dsSectionHeading} mt-4`} id="how-it-works-title">
          {LANDING_COPY.howItWorks.headingPlain}
          <span className="italic">{LANDING_COPY.howItWorks.headingItalic}</span>
        </h2>
      </div>

      <div className="relative mt-10 xl:px-7">
        <div className="relative xl:pt-16">
          <div className="grid grid-cols-1 gap-7 xl:grid-cols-12 xl:grid-rows-[minmax(340px,auto)_minmax(350px,auto)] xl:gap-x-7 xl:gap-y-16">
            <div
              className="relative flex min-w-0 flex-col xl:col-span-6 xl:col-start-1 xl:row-span-2 xl:row-start-1"
              onMouseEnter={() => {
                setHoverStep(0);
              }}
              onMouseLeave={() => {
                setHoverStep(null);
              }}
            >
              <LandingStepNode active={current === 0} num="1" />
              <LandingStepFeedCard active={current === 0} />
            </div>

            <div
              className="relative flex min-w-0 flex-col xl:col-span-6 xl:col-start-7 xl:row-start-1"
              onMouseEnter={() => {
                setHoverStep(1);
              }}
              onMouseLeave={() => {
                setHoverStep(null);
              }}
            >
              <LandingStepNode active={current === 1} num="2" />
              <LandingStepMatchCard active={current === 1} />
            </div>

            <div
              className="relative flex min-w-0 flex-col xl:col-span-6 xl:col-start-7 xl:row-start-2"
              onMouseEnter={() => {
                setHoverStep(2);
              }}
              onMouseLeave={() => {
                setHoverStep(null);
              }}
            >
              <LandingStepNode active={current === 2} num="3" />
              <LandingStepAppliedCard active={current === 2} />
            </div>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 hidden xl:block"
          >
            {gutterPath.map((seg) => {
              const lit = current === seg.leg;

              const borderClass =
                seg.orientation === "h"
                  ? "h-0 border-t-[3.5px] border-dotted"
                  : "w-0 border-l-[3.5px] border-dotted";

              return (
                <div
                  className={`absolute transition-colors duration-300 ${borderClass} ${
                    lit ? "border-signal" : "border-input"
                  }`}
                  key={seg.id}
                  style={seg.style}
                >
                  <span
                    className={`absolute left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal shadow-sh ${dotAnimClass(seg.dir, lit)}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
