import { useNavigate } from "react-router";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingResumeCard } from "../components/onboarding-resume-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingState,
  useUploadOnboardingResume,
} from "../lib/onboarding-api.ts";

export function OnboardingResumePage() {
  const navigate = useNavigate();
  const { data: state, isFetching, isPending, refetch } = useOnboardingState();
  const upload = useUploadOnboardingResume();
  const finish = useFinishOnboardingStep();

  return (
    <OnboardingShell step={2}>
      {state === undefined ? (
        <OnboardingLoadState
          onRetry={() => {
            void refetch();
          }}
          retrying={isFetching}
          state={isPending ? "loading" : "error"}
        />
      ) : (
        <OnboardingResumeCard
          error={upload.isError}
          onContinue={async () => {
            await finish.mutateAsync(2);
            await navigate("/onboarding/facts");
          }}
          onUpload={(file) => {
            upload.mutate(file);
          }}
          resume={state.resume}
          uploading={upload.isPending}
        />
      )}
    </OnboardingShell>
  );
}
