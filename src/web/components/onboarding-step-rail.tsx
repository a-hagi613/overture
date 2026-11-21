import { copy } from "../../shared/copy.ts";
import { OnboardingStepDot } from "./onboarding-step-dot.tsx";

const CURRENT_STEP = 3;

function stateOf(position: number) {
  if (position < CURRENT_STEP) {
    return "done";
  }

  if (position === CURRENT_STEP) {
    return "on";
  }

  return "next";
}

export function OnboardingStepRail() {
  return (
    <>
      <ol aria-label={copy.onboarding.stepsLabel} className="rail-d">
        {copy.onboarding.steps.map((name, index) => {
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
          {copy.onboarding.stepPosition(CURRENT_STEP, copy.onboarding.steps.length)}{" "}
          <span className="font-medium text-muted-foreground">
            {copy.onboarding.stepSeparator} {copy.onboarding.stepName}
          </span>
        </p>
        <div aria-hidden="true" className="mt-0.5 flex gap-1.5">
          {copy.onboarding.steps.map((name, index) => {
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
