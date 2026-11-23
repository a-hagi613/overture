import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { CompanyBrandKey } from "./company-brands-data.ts";

import { dsCardTitle, dsEyebrow, dsMono } from "../ui/ds.ts";
import { companyBrands } from "./company-brands-data.ts";
import { CompanyBrandTile } from "./company-brands.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

export interface CueCardData {
  brandKey: CompanyBrandKey;
  role: string;
  score: number;
  dash: string;
  meta: string;
  rows: readonly { ask: string; fact: string }[];
  footNote: string;
  viaLine: string;
  progressPct: number;
  railTime: string;
}

export function LandingHeroCard({
  card,
  index,
  stamped,
}: {
  card: CueCardData;
  index: number;
  stamped: boolean;
}) {
  const companyName = companyBrands[card.brandKey].name;
  const reducedMotion = useReducedMotion() === true;

  return (
    <motion.article
      animate={{
        opacity: 1,
        rotate: 0,
        scale: stamped ? 0.99 : 1,
        y: stamped ? 2 : 0,
      }}
      className={`absolute inset-x-0 top-0 z-10 flex h-[274px] flex-col overflow-hidden rounded-xl border bg-card px-4 py-3.5 shadow-lift transition-colors duration-300 sm:inset-x-2.5 sm:h-[280px] sm:px-5 sm:py-4 ${
        stamped ? "border-signal" : "border-input"
      }`}
      exit={
        reducedMotion ? { opacity: 1 } : { opacity: 0, rotate: -7, scale: 0.85, x: -140, y: 50 }
      }
      initial={reducedMotion ? false : { opacity: 0, rotate: 2, scale: 0.94, y: 24 }}
      key={`${companyName}-${String(index)}`}
      transition={{ damping: 23, stiffness: 280, type: "spring" }}
    >
      <div className="flex items-center gap-3">
        <CompanyBrandTile brandKey={card.brandKey} />
        <div className="min-w-0 flex-1">
          <p className={`${dsCardTitle} truncate`}>{card.role}</p>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{companyName}</p>
        </div>
        <figure
          aria-label={`Match ${String(card.score)}`}
          className="relative m-0 h-12 w-12 flex-none sm:h-13 sm:w-13"
        >
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 56 56">
            <circle className="stroke-input" cx="28" cy="28" fill="none" r="24" strokeWidth="2.5" />
            <circle
              className="stroke-signal"
              cx="28"
              cy="28"
              fill="none"
              r="24"
              strokeDasharray={card.dash}
              strokeLinecap="round"
              strokeWidth="2.8"
              transform="rotate(-90 28 28)"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-serif text-card-title leading-none tabular-nums text-signal-text">
            {card.score}
          </span>
        </figure>
      </div>

      <p className={`${dsMono} mt-2 truncate`}>{card.meta}</p>

      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)]">
        <span className={dsEyebrow}>{LANDING_COPY.heroStack.postingAsks}</span>
        <span />
        <span className={dsEyebrow}>{LANDING_COPY.heroStack.yourResume}</span>
      </div>

      <div className="mt-1.5 flex flex-col gap-1.5">
        {card.rows.map((row, rowIdx) => (
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-x-2 leading-snug sm:grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)]"
            initial={reducedMotion ? false : { opacity: 0, x: -6 }}
            key={row.ask}
            transition={
              reducedMotion ? { duration: 0 } : { delay: 0.12 + rowIdx * 0.11, duration: 0.34 }
            }
          >
            <span className="truncate text-xs text-muted-foreground">{row.ask}</span>
            <span
              aria-hidden="true"
              className="relative block h-0 border-t border-dotted border-ok after:absolute after:-right-0.5 after:-top-1 after:h-1.5 after:w-1.5 after:rounded-full after:bg-ok"
            />
            <span className="truncate text-xs font-semibold text-foreground">{row.fact}</span>
          </motion.div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <span className="truncate text-xs text-muted-foreground">{card.footNote}</span>
        <span className={`${dsMono} flex-none`}>{card.viaLine}</span>
      </div>

      <AnimatePresence>
        {stamped ? (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            exit={{ opacity: 0, scale: 0.96 }}
            initial={{ opacity: 0, scale: 2.1 }}
            transition={{ damping: 21, mass: 0.68, stiffness: 460, type: "spring" }}
          >
            <span className="-rotate-10 inline-flex items-center justify-center rounded-lg border-[3px] border-signal bg-card/95 p-1 shadow-sh">
              <span className="inline-flex items-center justify-center rounded border border-dashed border-signal px-5 py-1.5 font-sans text-card-title font-extrabold uppercase leading-none tracking-[0.18em] text-signal">
                {LANDING_COPY.heroStack.appliedStamp}
              </span>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
