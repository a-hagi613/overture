import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingFactsCard } from "../components/onboarding-facts-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingFacts,
  useSaveOnboardingFacts,
} from "../lib/onboarding-api.ts";

export function OnboardingFactsPage() {
  const navigate = useNavigate();
  const { data, isFetching, isPending, refetch } = useOnboardingFacts();
  const mutation = useSaveOnboardingFacts();
  const finish = useFinishOnboardingStep();

  return (
    <OnboardingShell labels={copy.onboarding.factsStepLabels} step={3}>
      {data === undefined ? (
        <OnboardingLoadState
          onRetry={() => {
            void refetch();
          }}
          retrying={isFetching}
          state={isPending ? "loading" : "error"}
        />
      ) : (
        <OnboardingFactsCard
          backTo="/onboarding/resume"
          onContinue={async () => {
            await finish.mutateAsync(3);
            await navigate("/onboarding/targets");
          }}
          save={async (input) => mutation.mutateAsync(input)}
          view={data}
        />
      )}
    </OnboardingShell>
  );
}
