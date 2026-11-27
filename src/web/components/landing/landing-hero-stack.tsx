import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import type { CueCardData } from "./landing-hero-card.tsx";

import { LANDING_COPY } from "./landing-copy.ts";
import { LandingHeroCard } from "./landing-hero-card.tsx";

const cueCards: readonly CueCardData[] = [
  {
    brandKey: "stripe",
    dash: "141.7 150.8",
    footNote: "14 saved answers · resume unchanged",
    meta: "New York, NY · Hybrid · US$140k–168k",
    progressPct: 6,
    railTime: "8:35 am",
    role: "Financial Planning Analyst",
    rows: [
      { ask: "5+ yrs FP&A modeling", fact: "6 yrs multi-market FP&A" },
      { ask: "SaaS revenue forecasting", fact: "Owned $180M ARR forecast" },
      { ask: "SQL & BI reporting", fact: "Daily SQL, Looker & Excel" },
      { ask: "US work authorization", fact: "Verified in your saved answers" },
    ],
    score: 94,
    viaLine: "8:35 am · Stripe",
  },
  {
    brandKey: "nike",
    dash: "137.2 150.8",
    footNote: "12 saved answers · cover letter tailored",
    meta: "Portland, OR · Hybrid · US$132k–155k",
    progressPct: 16,
    railTime: "9:48 am",
    role: "Brand Marketing Manager",
    rows: [
      { ask: "Global campaign launches", fact: "Led 9 seasonal launches" },
      { ask: "Retail & social media mix", fact: "Managed $8M omnichannel" },
      { ask: "Agency partner leadership", fact: "Directed 4 creative shops" },
      { ask: "Pacific timezone hybrid", fact: "Based in Portland metro" },
    ],
    score: 91,
    viaLine: "9:48 am · Nike",
  },
  {
    brandKey: "airbnb",
    dash: "135.7 150.8",
    footNote: "15 saved answers · resume unchanged",
    meta: "San Francisco, CA · Remote · US$148k–172k",
    progressPct: 27,
    railTime: "11:05 am",
    role: "Trust & Safety Operations Lead",
    rows: [
      { ask: "Risk & policy operations", fact: "5 yrs marketplace safety" },
      { ask: "Incident escalation SLAs", fact: "Cut triage time by 38%" },
      { ask: "Cross-regional playbooks", fact: "Built Americas & EMEA SOPs" },
      { ask: "Executive KPI briefings", fact: "Weekly VP risk reviews" },
    ],
    score: 90,
    viaLine: "11:05 am · Airbnb",
  },
  {
    brandKey: "shopify",
    dash: "138.7 150.8",
    footNote: "13 saved answers · cover letter tailored",
    meta: "Toronto, ON · Remote · CA$125k–148k",
    progressPct: 37,
    railTime: "12:18 pm",
    role: "Merchant Operations Manager",
    rows: [
      { ask: "E-commerce onboarding", fact: "Scaled 1,200+ retail accounts" },
      { ask: "Fulfillment & SLA metrics", fact: "99.2% on-time delivery rate" },
      { ask: "Cross-functional rollouts", fact: "Partnered with Sales & Legal" },
      { ask: "Remote in Canada", fact: "Toronto, remote preferred" },
    ],
    score: 92,
    viaLine: "12:18 pm · Shopify",
  },
  {
    brandKey: "airCanada",
    dash: "132.7 150.8",
    footNote: "11 saved answers · resume unchanged",
    meta: "Montreal, QC · Hybrid · CA$108k–128k",
    progressPct: 47,
    railTime: "1:30 pm",
    role: "Network Operations Planner",
    rows: [
      { ask: "Route capacity planning", fact: "4 yrs fleet & hub scheduling" },
      { ask: "Demand & load forecasting", fact: "Built seasonal load models" },
      { ask: "English & French fluency", fact: "Bilingual EN / FR in your saved answers" },
      { ask: "Canadian work eligibility", fact: "Verified in your saved answers" },
    ],
    score: 88,
    viaLine: "1:30 pm · Air Canada",
  },
  {
    brandKey: "spotify",
    dash: "140.2 150.8",
    footNote: "14 saved answers · cover letter tailored",
    meta: "Stockholm, Sweden · Hybrid · €78k–94k",
    progressPct: 57,
    railTime: "2:42 pm",
    role: "People & Culture Partner",
    rows: [
      { ask: "HRBP for 250+ orgs", fact: "6 yrs partnering with VPs" },
      { ask: "Compensation & leveling", fact: "Led annual EU comp cycles" },
      { ask: "Nordic labor frameworks", fact: "Swedish & EU HR compliance" },
      { ask: "Org design facilitation", fact: "Guided 3 studio reorganizations" },
    ],
    score: 93,
    viaLine: "2:42 pm · Spotify",
  },
  {
    brandKey: "hsbc",
    dash: "134.2 150.8",
    footNote: "16 saved answers · resume unchanged",
    meta: "London, UK · Hybrid · £82k–98k",
    progressPct: 68,
    railTime: "3:55 pm",
    role: "Compliance & Risk Advisor",
    rows: [
      { ask: "FCA & AML governance", fact: "5 yrs UK retail & commercial" },
      { ask: "Regulatory audit readiness", fact: "Zero findings in 3 audits" },
      { ask: "Policy risk assessments", fact: "Authored board risk packs" },
      { ask: "UK right to work", fact: "Verified in your saved answers" },
    ],
    score: 89,
    viaLine: "3:55 pm · HSBC",
  },
  {
    brandKey: "tata",
    dash: "137.2 150.8",
    footNote: "12 saved answers · cover letter tailored",
    meta: "Bengaluru, India · Hybrid · ₹36L–46L",
    progressPct: 78,
    railTime: "5:04 pm",
    role: "Operations Program Manager",
    rows: [
      { ask: "Multi-site plant delivery", fact: "Led 4 regional rollouts" },
      { ask: "Vendor & supply governance", fact: "Negotiated $14M supplier SLAs" },
      { ask: "Lean Six Sigma execution", fact: "Black Belt · cut waste 22%" },
      { ask: "APAC stakeholder cadence", fact: "Weekly CXO milestone reviews" },
    ],
    score: 91,
    viaLine: "5:04 pm · Tata Group",
  },
  {
    brandKey: "emirates",
    dash: "135.7 150.8",
    footNote: "13 saved answers · resume unchanged",
    meta: "Dubai, UAE · On-site · AED 30k–36k/mo",
    progressPct: 87,
    railTime: "6:12 pm",
    role: "Aviation Operations Coordinator",
    rows: [
      { ask: "International hub operations", fact: "5 yrs wide-body turnarounds" },
      { ask: "IATA safety compliance", fact: "IATA certified · zero incidents" },
      { ask: "24/7 crew coordination", fact: "Managed 80+ crew rosters" },
      { ask: "UAE relocation ready", fact: "Confirmed in your saved answers" },
    ],
    score: 90,
    viaLine: "6:12 pm · Emirates",
  },
  {
    brandKey: "hormuud",
    dash: "135.7 150.8",
    footNote: "11 saved answers · cover letter tailored",
    meta: "Mogadishu, Somalia · Hybrid · Full-time",
    progressPct: 95,
    railTime: "7:20 pm",
    role: "Mobile Money Operations Lead",
    rows: [
      { ask: "Mobile payments operations", fact: "5 yrs EVC & agent networks" },
      { ask: "Merchant settlement SLAs", fact: "99.8% daily reconciliation" },
      { ask: "AML & telecom compliance", fact: "Led Central Bank audits" },
      { ask: "Somali & English fluency", fact: "Bilingual SO / EN in your saved answers" },
    ],
    score: 90,
    viaLine: "7:20 pm · Hormuud Telecom",
  },
];

const railStops = [
  { label: "8 am", left: "0%" },
  { label: "10", left: "16.67%" },
  { label: "12", left: "33.33%" },
  { label: "2", left: "50%" },
  { label: "4", left: "66.67%" },
  { label: "6", left: "83.33%" },
  { label: "8 pm", left: "100%" },
] as const;

const READ_MS = 2500;
const STAMP_HOLD_MS = 1350;

function nearestCardIndex(pct: number) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [cardIndex, card] of cueCards.entries()) {
    const distance = Math.abs(card.progressPct - pct);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = cardIndex;
    }
  }

  return bestIndex;
}

export function LandingHeroStack({
  compact = false,
  surface = "background",
}: {
  compact?: boolean;
  surface?: "background" | "sidebar";
}) {
  const [index, setIndex] = useState(0);
  const [stamped, setStamped] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  const reduceMotion = useReducedMotion() === true;

  const currentCard = cueCards[index] ?? cueCards[0];
  const isScrubbing = scrubPct !== null;

  useEffect(() => {
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

    if (reduceMotion) {
      return () => undefined;
    }

    if (!isScrubbing && !stamped) {
      timer = globalThis.setTimeout(() => {
        setStamped(true);
        setAppliedCount((count) => count + 1);
      }, READ_MS);
    } else if (!isScrubbing) {
      timer = globalThis.setTimeout(() => {
        setStamped(false);
        setIndex((current) => {
          const next = (current + 1) % cueCards.length;

          if (next === 0) {
            setAppliedCount(0);
          }

          return next;
        });
      }, STAMP_HOLD_MS);
    }

    return () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [isScrubbing, reduceMotion, stamped]);

  const handleScrub = (nextPct: number) => {
    const nextIndex = nearestCardIndex(nextPct);

    setScrubPct(nextPct);
    setStamped(false);
    setIndex(nextIndex);
    setAppliedCount(nextIndex);
  };

  const finishScrub = () => {
    setScrubPct(null);
  };

  if (currentCard === undefined) {
    return null;
  }

  const displayPct = scrubPct ?? currentCard.progressPct;
  const motionClass = scrubPct === null ? "transition-[width,left] duration-300" : "";

  return (
    <section
      aria-label={LANDING_COPY.heroStack.ariaLabel}
      className={compact ? "w-full max-w-[520px]" : "mx-auto w-full max-w-[650px]"}
    >
      <div className="relative z-10 h-[364px] sm:h-[404px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[328px] -translate-x-1 translate-y-4 -rotate-1 scale-95 rounded-xl border border-input bg-card opacity-65 shadow-sh sm:inset-x-2.5 sm:h-[368px] sm:-translate-x-2 sm:translate-y-5 sm:-rotate-2"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-1 h-[328px] translate-x-1 translate-y-2.5 rotate-1 scale-[0.97] rounded-xl border border-input bg-card opacity-85 shadow-sh sm:inset-x-2.5 sm:h-[368px] sm:translate-x-2.5 sm:translate-y-3 sm:rotate-2"
        />

        <AnimatePresence initial={false} mode="popLayout">
          <LandingHeroCard card={currentCard} index={index} stamped={stamped} />
        </AnimatePresence>
      </div>

      {compact ? null : (
        <>
          <output className="mx-1 mt-2 flex items-center justify-between sm:mx-3.5">
            <span className="inline-flex items-baseline gap-2">
              <span className="font-serif text-card-title font-normal leading-none text-foreground">
                {LANDING_COPY.heroStack.appliedLabel}
              </span>
              <motion.b
                animate={{ scale: 1 }}
                className="inline-block font-serif text-card-title font-normal leading-none tabular-nums text-signal-text"
                initial={{ scale: 1.24 }}
                key={`a-${String(appliedCount)}`}
                transition={{ damping: 18, stiffness: 380, type: "spring" }}
              >
                {appliedCount}
              </motion.b>
            </span>
          </output>

          <figure
            aria-label={LANDING_COPY.heroStack.windowAria}
            className="relative mx-2.5 mb-0 mt-9 h-18 sm:mx-5"
          >
            <input
              aria-label={LANDING_COPY.heroStack.windowAria}
              aria-valuetext={`${currentCard.railTime} · ${currentCard.role}`}
              className="peer absolute inset-x-0 top-1 z-20 h-11 w-full cursor-grab opacity-0 active:cursor-grabbing"
              max={100}
              min={0}
              onBlur={finishScrub}
              onChange={(event) => {
                handleScrub(Number(event.currentTarget.value));
              }}
              onKeyUp={finishScrub}
              onPointerUp={finishScrub}
              onTouchEnd={finishScrub}
              step={1}
              type="range"
              value={displayPct}
            />
            <div className="pointer-events-none absolute inset-x-0 top-6.5 h-1 rounded-full bg-border" />
            <div
              className={`pointer-events-none absolute left-0 top-6.5 h-1 rounded-full bg-signal ${motionClass}`}
              style={{ width: `${String(displayPct)}%` }}
            />
            {railStops.map((stop) => (
              <span className="pointer-events-none" key={stop.left}>
                <span
                  className="absolute top-6 h-3 border-l border-foreground"
                  style={{ left: stop.left }}
                />
                <span
                  className="absolute top-10 -translate-x-1/2 whitespace-nowrap font-mono text-xs text-muted-foreground"
                  style={{ left: stop.left }}
                >
                  {stop.label}
                </span>
              </span>
            ))}
            {cueCards.map((card) => (
              <span
                className={`pointer-events-none absolute top-7 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  card.progressPct <= displayPct ? "bg-signal" : "bg-foreground/30"
                }`}
                key={card.railTime}
                style={{ left: `${String(card.progressPct)}%` }}
              />
            ))}
            <span
              className={`pointer-events-none absolute top-7 h-0 w-0 ${motionClass}`}
              style={{ left: `${String(displayPct)}%` }}
            >
              <span
                className={`absolute -left-4 -top-2.5 flex h-5 w-8 items-center justify-center gap-1 rounded-full bg-signal shadow-sh ring-4 transition-transform peer-hover:scale-105 peer-focus-visible:ring-2 peer-focus-visible:ring-foreground ${
                  surface === "sidebar" ? "ring-sidebar" : "ring-background"
                }`}
              >
                <span className="h-2 w-0.5 rounded-full bg-primary-ink/90" />
                <span className="h-2 w-0.5 rounded-full bg-primary-ink/90" />
              </span>
              <span className="absolute bottom-5 left-0 -translate-x-1/2 whitespace-nowrap rounded border border-input bg-card px-2.5 py-1 font-mono text-xs text-foreground shadow-sh sm:text-sm">
                {currentCard.railTime}
              </span>
            </span>
          </figure>
        </>
      )}
    </section>
  );
}
