import { Check } from "lucide-react";

import { copy } from "../../shared/copy.ts";

export function OnboardingStepRail({
  labels = copy.onboarding.steps,
  step,
}: {
  labels?: readonly string[] | undefined;
  step: number;
}) {
  const current = Math.min(Math.max(step, 1), labels.length);

  return (
    <div className="my-5">
      <ol
        aria-label={copy.onboarding.stepsLabel}
        className="hidden items-center gap-2 md:grid md:grid-cols-4"
      >
        {labels.map((name, index) => {
          const position = index + 1;
          const done = position < current;
          const active = position === current;

          let cardClass = "border-border bg-card/60 text-muted-foreground";
          let dotClass = "border-border bg-muted text-muted-foreground";

          if (done) {
            cardClass = "border-ok/35 bg-ok-soft/45 text-foreground";
            dotClass = "border-ok bg-ok text-primary-ink";
          } else if (active) {
            cardClass = "border-signal/60 bg-card text-foreground";
            dotClass = "border-signal bg-signal text-primary-ink";
          }

          return (
            <li
              className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs font-semibold transition ${cardClass}`}
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
