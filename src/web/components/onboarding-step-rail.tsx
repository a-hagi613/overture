import { copy } from "../../shared/copy.ts";
import { OnboardingStepDot } from "./onboarding-step-dot.tsx";

export function OnboardingStepRail({
  labels = copy.onboarding.steps,
  step,
}: {
  labels?: readonly string[];
  step: number;
}) {
  const current = Math.min(Math.max(step, 1), labels.length);

  const stateOf = (position: number) => {
    if (position < current) {
      return "done";
    }

    if (position === current) {
      return "on";
    }

    return "next";
  };

  return (
    <>
      <ol aria-label={copy.onboarding.stepsLabel} className="rail-d">
        {labels.map((name, index) => {
          const position = index + 1;
          const state = stateOf(position);

          return (
            <li className={state === "next" ? "" : state} key={name}>
              <span aria-current={state === "on" ? "step" : undefined} className="rb2">
                <OnboardingStepDot position={position} state={state} />
                {name}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="rail-m">
        <p className="num text-[13px] font-semibold">
          {copy.onboarding.stepPosition(current, labels.length)}{" "}
          <span className="font-medium text-muted-foreground">
            {copy.onboarding.stepSeparator} {labels[current - 1]}
          </span>
        </p>
        <div aria-hidden="true" className="mt-0.5 flex gap-1.5">
          {labels.map((name, index) => {
            const state = stateOf(index + 1);

            return (
              <span
                aria-hidden="true"
                className={`seg4 ${state === "next" ? "" : state}`}
                key={name}
              >
                <span />
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
