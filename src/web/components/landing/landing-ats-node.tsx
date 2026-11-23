import { AnimatePresence, motion } from "motion/react";
import type { RefObject } from "react";

import type { AtsLogoId } from "./ats-logos.tsx";

import { AtsLogo } from "./ats-logos.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

const atsNodeTile =
  "relative z-10 flex h-14 w-14 flex-none items-center justify-center rounded-2xl border bg-band-bg transition duration-300 sm:h-16 sm:w-16";

const atsLogoFrame = "block h-full w-full overflow-hidden rounded-[15px]";

export function LandingAtsNode({
  active,
  id,
  name,
  nodeRef,
  side,
  sub,
}: {
  active: boolean;
  id: AtsLogoId;
  name: string;
  nodeRef: RefObject<HTMLDivElement | null>;
  side: "left" | "right";
  sub: string;
}) {
  const isLeft = side === "left";
  const badgePos = isLeft ? "-bottom-3 sm:-top-3 sm:bottom-auto" : "-top-3";

  return (
    <div
      className={
        isLeft
          ? "flex flex-col-reverse items-center gap-1.5 text-center sm:flex-row-reverse sm:gap-3 sm:text-right"
          : "flex flex-col items-center gap-1.5 text-center sm:flex-row sm:gap-3 sm:text-left"
      }
    >
      <div
        className={`${atsNodeTile} ${
          active ? "scale-105 border-signal ring-4 ring-signal-soft" : "border-band-line"
        }`}
        ref={nodeRef}
      >
        <span className={atsLogoFrame}>
          <AtsLogo id={id} />
        </span>
        <AnimatePresence>
          {active ? (
            <motion.span
              animate={{ opacity: 1, y: 0 }}
              className={`absolute inset-x-0 z-20 mx-auto inline-flex w-fit items-center rounded-full border border-signal bg-band-bg px-2.5 py-0.5 font-sans text-eyebrow font-semibold uppercase tracking-wider text-band-ink whitespace-nowrap ${badgePos}`}
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 5 }}
              transition={{ duration: 0.25 }}
            >
              {LANDING_COPY.whereItApplies.appliedBadge}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-semibold text-band-ink sm:text-sm">{name}</span>
        <span className="hidden font-mono text-xs text-band-muted sm:block">{sub}</span>
      </div>
    </div>
  );
}
