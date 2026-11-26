import { useNavigate, useSearchParams } from "react-router";

import { OnboardingGapsCard } from "../components/onboarding-gaps-card.tsx";
import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingGaps,
  useSaveOnboardingGaps,
} from "../lib/onboarding-api.ts";

export function OnboardingGapsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const gaps = useOnboardingGaps();
  const save = useSaveOnboardingGaps();
  const finish = useFinishOnboardingStep();

  if (gaps.data === undefined) {
    return (
      <OnboardingShell step={2}>
        <OnboardingLoadState
          onRetry={() => {
            void gaps.refetch();
          }}
          retrying={gaps.isFetching}
          state={gaps.isError ? "error" : "loading"}
        />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={2}>
      <OnboardingGapsCard
        backTo={`/onboarding/resume${suffix}`}
        fields={gaps.data.fields}
        onContinue={async () => {
          if (!preview) {
            await finish.mutateAsync(3);
          }

          await navigate(`/onboarding/targets${suffix}`);
        }}
        onSave={async (fields) => {
          await save.mutateAsync(fields);
        }}
        preview={preview}
      />
    </OnboardingShell>
  );
}
