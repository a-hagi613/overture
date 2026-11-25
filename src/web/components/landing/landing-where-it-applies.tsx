import { useEffect, useRef, useState } from "react";

import { AnimatedBeam } from "../ui/animated-beam.tsx";
import { LandingAtsNode } from "./landing-ats-node.tsx";
import { LANDING_COPY } from "./landing-copy.ts";
import { OvertureHubMark } from "./overture-hub-mark.tsx";

export function LandingWhereItApplies() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const ghRef = useRef<HTMLDivElement>(null);
  const leverRef = useRef<HTMLDivElement>(null);
  const ashbyRef = useRef<HTMLDivElement>(null);
  const srRef = useRef<HTMLDivElement>(null);
  const personioRef = useRef<HTMLDivElement>(null);
  const workableRef = useRef<HTMLDivElement>(null);
  const recruiteeRef = useRef<HTMLDivElement>(null);
  const bambooRef = useRef<HTMLDivElement>(null);

  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setActiveIdx((current) => (current + 1) % 8);
    }, 2400);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  return (
    <figure
      aria-label={LANDING_COPY.whereItApplies.diagramAria}
      className="relative m-0 overflow-hidden rounded-2xl border border-border bg-card px-5 py-10 shadow-sh sm:px-14 sm:py-16 lg:px-16 lg:py-20"
      id="where-it-applies"
      ref={containerRef}
    >
      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 items-center justify-items-center gap-12 sm:grid-cols-[minmax(0,auto)_minmax(200px,1fr)_minmax(0,auto)] sm:gap-x-14 sm:gap-y-8">
        <div className="grid w-full grid-cols-4 items-start gap-2.5 sm:flex sm:w-auto sm:flex-col sm:items-end sm:gap-9">
          <LandingAtsNode
            active={activeIdx === 0}
            id="greenhouse"
            name="Greenhouse"
            nodeRef={ghRef}
            side="left"
            sub="Career portals"
          />
          <LandingAtsNode
            active={activeIdx === 1}
            id="lever"
            name="Lever"
            nodeRef={leverRef}
            side="left"
            sub="Direct job forms"
          />
          <LandingAtsNode
            active={activeIdx === 2}
            id="ashby"
            name="Ashby"
            nodeRef={ashbyRef}
            side="left"
            sub="Modern hiring teams"
          />
          <LandingAtsNode
            active={activeIdx === 3}
            id="smartrecruiters"
            name="SmartRecruiters"
            nodeRef={srRef}
            side="left"
            sub="Enterprise hiring"
          />
        </div>

        <div className="flex flex-col items-center gap-3.5">
          <div
            className="relative z-10 flex h-24 w-24 items-center justify-center rounded-2xl border border-input bg-background shadow-sh sm:h-28 sm:w-28 lg:h-32 lg:w-32"
            ref={hubRef}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-5 rounded-2xl border border-border animate-hub-pulse"
            />
            <OvertureHubMark />
          </div>
          <span className="font-serif text-page-title leading-none text-foreground">
            {LANDING_COPY.whereItApplies.hubLabel}
          </span>
          <span className="hidden text-center font-mono text-xs text-muted-foreground sm:block sm:whitespace-nowrap">
            {LANDING_COPY.whereItApplies.hubSub}
          </span>
        </div>

        <div className="grid w-full grid-cols-4 items-start gap-2.5 sm:flex sm:w-auto sm:flex-col sm:items-start sm:gap-9">
          <LandingAtsNode
            active={activeIdx === 4}
            id="personio"
            name="Personio"
            nodeRef={personioRef}
            side="right"
            sub="European teams"
          />
          <LandingAtsNode
            active={activeIdx === 5}
            id="workable"
            name="Workable"
            nodeRef={workableRef}
            side="right"
            sub="Company boards"
          />
          <LandingAtsNode
            active={activeIdx === 6}
            id="recruitee"
            name="Recruitee"
            nodeRef={recruiteeRef}
            side="right"
            sub="Collaborative ATS"
          />
          <LandingAtsNode
            active={activeIdx === 7}
            id="bamboohr"
            name="BambooHR"
            nodeRef={bambooRef}
            side="right"
            sub="Growing teams"
          />
        </div>
      </div>

      <AnimatedBeam
        containerRef={containerRef}
        curvature={-96}
        delay={0}
        duration={2.6}
        fromRef={ghRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 0 ? 0.85 : 0.4}
        pathWidth={activeIdx === 0 ? 3 : 2}
        reverse
        toRef={hubRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={-34}
        delay={0.4}
        duration={2.6}
        fromRef={leverRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 1 ? 0.85 : 0.4}
        pathWidth={activeIdx === 1 ? 3 : 2}
        reverse
        toRef={hubRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={34}
        delay={0.8}
        duration={2.6}
        fromRef={ashbyRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 2 ? 0.85 : 0.4}
        pathWidth={activeIdx === 2 ? 3 : 2}
        reverse
        toRef={hubRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={96}
        delay={1.2}
        duration={2.6}
        fromRef={srRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 3 ? 0.85 : 0.4}
        pathWidth={activeIdx === 3 ? 3 : 2}
        reverse
        toRef={hubRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={-96}
        delay={0.2}
        duration={2.6}
        fromRef={hubRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 4 ? 0.85 : 0.4}
        pathWidth={activeIdx === 4 ? 3 : 2}
        toRef={personioRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={-34}
        delay={0.6}
        duration={2.6}
        fromRef={hubRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 5 ? 0.85 : 0.4}
        pathWidth={activeIdx === 5 ? 3 : 2}
        toRef={workableRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={34}
        delay={1}
        duration={2.6}
        fromRef={hubRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 6 ? 0.85 : 0.4}
        pathWidth={activeIdx === 6 ? 3 : 2}
        toRef={recruiteeRef}
      />
      <AnimatedBeam
        containerRef={containerRef}
        curvature={96}
        delay={1.4}
        duration={2.6}
        fromRef={hubRef}
        pathColor="var(--color-input)"
        pathOpacity={activeIdx === 7 ? 0.85 : 0.4}
        pathWidth={activeIdx === 7 ? 3 : 2}
        toRef={bambooRef}
      />
    </figure>
  );
}
