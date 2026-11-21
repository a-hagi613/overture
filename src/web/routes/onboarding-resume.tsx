import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { OnboardingResumeCard } from "../components/onboarding-resume-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingState,
  useUploadOnboardingResume,
} from "../lib/onboarding-api.ts";

export function OnboardingResumePage() {
  const navigate = useNavigate();
  const { data: state, isPending } = useOnboardingState();
  const upload = useUploadOnboardingResume();
  const finish = useFinishOnboardingStep();

  return (
    <OnboardingShell step={2}>
      {state === undefined ? (
        <p className="mt-8 text-[13.5px] text-muted-foreground">
          {isPending ? "" : copy.onboarding.loadFailed}
        </p>
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
