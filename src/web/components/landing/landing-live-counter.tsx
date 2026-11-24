import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { LANDING_COPY } from "./landing-copy.ts";

const BASE_APPLIED = 42_819;

export function LandingLiveCounter() {
  const [count, setCount] = useState(BASE_APPLIED);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setCount((current) => current + 1);
    }, 3400);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  return (
    <output
      aria-live="polite"
      className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground sm:text-sm"
      data-testid="hero-counter"
    >
      <span
        aria-hidden="true"
        className="relative flex h-2.5 w-2.5 flex-none items-center justify-center"
      >
        <span className="absolute inset-0 rounded-full bg-signal animate-live-ping" />
        <span className="relative h-2 w-2 rounded-full bg-signal ring-2 ring-signal-soft animate-hint-pulse" />
      </span>
      <span className="flex items-baseline gap-1.5">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="font-mono font-semibold tabular-nums text-foreground"
          data-testid="hero-counter-value"
          initial={{ opacity: 0.4, y: -2 }}
          key={count}
          transition={{ duration: 0.25 }}
        >
          {count.toLocaleString("en-US")}
        </motion.span>
        <span>{LANDING_COPY.hero.liveCounterSuffix}</span>
      </span>
    </output>
  );
}
