import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { OnboardingFactsCard } from "../components/onboarding-facts-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingFacts,
  useSaveOnboardingFacts,
} from "../lib/onboarding-api.ts";

export function OnboardingFactsPage() {
  const navigate = useNavigate();
  const { data, isPending } = useOnboardingFacts();
  const mutation = useSaveOnboardingFacts();
  const finish = useFinishOnboardingStep();

  return (
    <OnboardingShell labels={copy.onboarding.factsStepLabels} step={3}>
      {data === undefined ? (
        <p className="mt-8 text-[13.5px] text-muted-foreground">
          {isPending ? "" : copy.onboarding.loadFailed}
        </p>
      ) : (
        <OnboardingFactsCard
          backTo="/onboarding/resume"
          onContinue={async () => {
            await finish.mutateAsync(3);
            await navigate("/profile#profile-facts");
          }}
          save={async (input) => mutation.mutateAsync(input)}
          view={data}
        />
      )}
    </OnboardingShell>
  );
}
