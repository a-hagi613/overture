import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { copy } from "../../shared/copy.ts";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingTrialCard } from "../components/onboarding-trial-card.tsx";
import type { TrialCardState } from "../components/onboarding-trial-card.tsx";
import { startCardSetup, verifyTrialCard } from "../lib/trial-api.ts";

const labels = [...copy.onboarding.steps, copy.onboarding.trial.stepLabel];

export function OnboardingTrialPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<TrialCardState>("verify");
  const sessionId = params.get("session");
  const returned = params.get("card") === "verified" && sessionId !== null;

  const verify = useMutation({
    mutationFn: async () => {
      if (!returned) {
        globalThis.location.assign(await startCardSetup());

        return "redirect" as const;
      }

      return verifyTrialCard(sessionId);
    },
    onSuccess: async (outcome) => {
      if (outcome === "granted") {
        await navigate("/notifications");

        return;
      }

      if (outcome !== "redirect") {
        setState(outcome);
      }
    },
  });

  const restart = useMutation({
    mutationFn: async () => {
      globalThis.location.assign(await startCardSetup());
    },
  });

  return (
    <OnboardingShell labels={labels} step={6}>
      <OnboardingTrialCard
        busy={verify.isPending || restart.isPending}
        error={verify.isError || restart.isError}
        onVerify={state === "verify" ? verify.mutate : restart.mutate}
        state={state}
      />
    </OnboardingShell>
  );
}
