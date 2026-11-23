import { useNavigate, useSearchParams } from "react-router";

import { copy } from "../../shared/copy.ts";
import { OnboardingFactsCard } from "../components/onboarding-facts-card.tsx";
import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingFacts,
  useSaveOnboardingFacts,
} from "../lib/onboarding-api.ts";

export function OnboardingFactsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
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
          backTo={`/onboarding/resume${suffix}`}
          onContinue={async () => {
            if (!preview) {
              await finish.mutateAsync(3);
            }

            await navigate(`/onboarding/targets${suffix}`);
          }}
          preview={preview}
          save={async (input) => mutation.mutateAsync(input)}
          view={data}
        />
      )}
    </OnboardingShell>
  );
}
