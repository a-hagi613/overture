import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingResumeCard } from "../components/onboarding-resume-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import type { OnboardingState } from "../lib/onboarding-api.ts";
import {
  useFinishOnboardingStep,
  useOnboardingState,
  useUploadOnboardingResume,
} from "../lib/onboarding-api.ts";
import { resumeFileUrl } from "../lib/profile-api.ts";

type ResumeView = NonNullable<OnboardingState["resume"]>;

export function OnboardingResumePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const { data: state, isFetching, isPending, refetch } = useOnboardingState();
  const upload = useUploadOnboardingResume();
  const finish = useFinishOnboardingStep();
  const [previewResume, setPreviewResume] = useState<ResumeView | null>(null);
  const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (localPdfUrl !== null) {
        URL.revokeObjectURL(localPdfUrl);
      }
    },
    [localPdfUrl],
  );

  const effectiveResume = preview
    ? (previewResume ?? state?.resume ?? null)
    : (state?.resume ?? null);

  const resolvedPdfUrl =
    localPdfUrl ?? (effectiveResume === null ? null : resumeFileUrl(effectiveResume.id));

  return (
    <OnboardingShell step={1}>
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
          backLabel={preview ? copy.onboarding.backToWorkspace : copy.onboarding.back}
          backTo={preview ? "/home" : undefined}
          error={upload.isError && !preview}
          onContinue={async () => {
            if (!preview) {
              await finish.mutateAsync(2);
            }

            await navigate(`/onboarding/gaps${suffix}`);
          }}
          onUpload={(file) => {
            if (localPdfUrl !== null) {
              URL.revokeObjectURL(localPdfUrl);
            }

            setLocalPdfUrl(URL.createObjectURL(file));

            if (preview) {
              setPreviewResume({
                bytes: Math.max(1024, file.size),
                filename: file.name,
                id: "preview-resume",
                pages: 1,
                unreadable: false,
                uploadedAt: new Date().toISOString(),
              });
              toast.info(`Preview mode: ${file.name} selected.`);

              return;
            }

            upload.mutate(file, {
              onSuccess: () => {
                setLocalPdfUrl(null);
              },
            });
          }}
          pdfUrl={resolvedPdfUrl}
          resume={effectiveResume}
          uploading={upload.isPending}
        />
      )}
    </OnboardingShell>
  );
}
