import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingResumeCard } from "../components/onboarding-resume-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { useOnboardingState, useUploadOnboardingResume } from "../lib/onboarding-api.ts";

export function OnboardingResumePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const { data: state, isFetching, isPending, refetch } = useOnboardingState();
  const upload = useUploadOnboardingResume();

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
          backTo="/home"
          error={upload.isError && !preview}
          onContinue={async () => {
            await navigate(`/onboarding/targets${suffix}`);
          }}
          onUpload={(file) => {
            upload.mutate(file, {
              onError: () => {
                if (preview) {
                  toast.info(`Preview mode: ${file.name} selected.`);
                }
              },
            });
          }}
          resume={state.resume}
          uploading={upload.isPending}
        />
      )}
    </OnboardingShell>
  );
}
