import { Check } from "lucide-react";

import { copy } from "../../shared/copy.ts";

export function OnboardingStepRail({
  labels = copy.onboarding.steps,
  step,
}: {
  labels?: readonly string[];
  step: number;
}) {
  const current = Math.min(Math.max(step, 1), labels.length);

  return (
    <div className="my-6">
      <ol
        aria-label={copy.onboarding.stepsLabel}
        className="hidden items-center justify-between gap-2 rounded-xl border border-border bg-card p-2 shadow-sh md:flex"
      >
        {labels.map((name, index) => {
          const position = index + 1;
          const done = position < current;
          const active = position === current;

          let dotClass = "border-border bg-muted text-muted-foreground";

          if (done) {
            dotClass = "border-ok bg-ok text-primary-ink";
          } else if (active) {
            dotClass = "border-signal bg-signal text-primary-ink";
          }

          return (
            <li
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                active ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
              key={name}
            >
              <span
                aria-current={active ? "step" : undefined}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums ${dotClass}`}
              >
                {done ? <Check aria-hidden="true" size={12} /> : String(position)}
              </span>
              <span className="truncate">{name}</span>
            </li>
          );
        })}
      </ol>

      <div className="md:hidden">
        <p className="text-xs font-semibold text-foreground tabular-nums">
          {copy.onboarding.stepPosition(current, labels.length)}{" "}
          <span className="font-medium text-muted-foreground">
            {`${copy.onboarding.stepSeparator} ${labels[current - 1] ?? ""}`}
          </span>
        </p>
        <div aria-hidden="true" className="mt-2 flex gap-1.5">
          {labels.map((name, index) => {
            const position = index + 1;

            let barClass = "bg-border";

            if (position < current) {
              barClass = "bg-ok";
            } else if (position === current) {
              barClass = "bg-signal";
            }

            return <span className={`h-1.5 flex-1 rounded-full ${barClass}`} key={name} />;
          })}
        </div>
      </div>
    </div>
  );
}
