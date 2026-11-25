import { CheckCircle2, FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { copy } from "../../shared/copy.ts";
import { dsEyebrow } from "./ui/ds.ts";

const LAST_STEP_INDEX = copy.onboarding.resumeScanningSteps.length - 1;

export function OnboardingResumeScan({ filename }: { filename: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setPhase((current) => (current < LAST_STEP_INDEX ? current + 1 : current));
    }, 520);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="rounded-lg border border-border bg-muted/40 p-5"
      data-testid="resume-scan"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-signal-text">
            <FileText aria-hidden="true" size={16} />
          </span>
          <div className="min-w-0">
            <output className={`${dsEyebrow} block`}>{copy.onboarding.resumeScanningTitle}</output>
            <p className="truncate font-mono text-xs font-medium text-foreground">{filename}</p>
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="relative mt-4 overflow-hidden rounded-lg border border-border bg-card p-4"
      >
        <div className="space-y-2.5">
          <div className="h-2.5 w-1/3 rounded-full bg-foreground/15" />
          <div className="h-2 w-2/3 rounded-full bg-muted" />
          <div className="pt-1 space-y-2">
            <div className="h-2 w-full rounded-full bg-muted" />
            <div className="h-2 w-5/6 rounded-full bg-muted" />
            <div className="h-2 w-3/4 rounded-full bg-muted" />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="ov-resume-scan-bar h-full w-full animate-resume-scan">
            <div className="h-0.5 w-full bg-signal" />
            <div className="h-12 w-full bg-gradient-to-b from-signal-soft to-transparent" />
          </div>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {copy.onboarding.resumeScanningSteps.map((stepLabel, index) => {
          const done = index < phase;
          const active = index === phase;

          return (
            <li className="flex items-center gap-2 text-xs" key={stepLabel}>
              {done ? (
                <CheckCircle2 aria-hidden="true" className="shrink-0 text-ok" size={14} />
              ) : (
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    active ? "bg-signal animate-pulse" : "bg-border"
                  }`}
                />
              )}
              <span
                className={done || active ? "font-medium text-foreground" : "text-muted-foreground"}
              >
                {stepLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
