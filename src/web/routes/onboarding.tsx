import { useEffect } from "react";
import { useNavigate } from "react-router";

import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingWelcomeCard } from "../components/onboarding-welcome-card.tsx";
import { useFinishOnboardingStep, useOnboardingState } from "../lib/onboarding-api.ts";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { data: state } = useOnboardingState();
  const finish = useFinishOnboardingStep();
  const step = state?.step ?? 1;

  useEffect(() => {
    if (state === undefined) {
      return;
    }

    if (state.step === 2) {
      void navigate("/onboarding/resume", { replace: true });
    } else if (state.step === 3) {
      void navigate("/onboarding/facts", { replace: true });
    } else if (state.step === 4) {
      void navigate("/onboarding/targets", { replace: true });
    } else if (state.step >= 5) {
      void navigate("/profile", { replace: true });
    }
  }, [navigate, state]);

  return (
    <OnboardingShell step={1}>
      {step <= 1 ? (
        <OnboardingWelcomeCard
          onContinue={async () => {
            await finish.mutateAsync(1);
            await navigate("/onboarding/resume");
          }}
        />
      ) : null}
    </OnboardingShell>
  );
}
