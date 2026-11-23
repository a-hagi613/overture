import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingWelcomeCard } from "../components/onboarding-welcome-card.tsx";
import { RouteFallback } from "../components/route-fallback.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useFinishOnboardingStep, useOnboardingState } from "../lib/onboarding-api.ts";

export function OnboardingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { data: state, isError, isFetching, refetch } = useOnboardingState();
  const finish = useFinishOnboardingStep();

  useEffect(() => {
    if (preview || state === undefined) {
      return;
    }

    if (state.step === 2) {
      void navigate("/onboarding/resume", { replace: true });
    } else if (state.step === 3) {
      void navigate("/onboarding/facts", { replace: true });
    } else if (state.step === 4) {
      void navigate("/onboarding/targets", { replace: true });
    } else if (state.step >= 5) {
      void navigate(state.onboardedAt === null ? "/onboarding/forward" : "/home", {
        replace: true,
      });
    }
  }, [navigate, preview, state]);

  if (!sessionPending && session === null) {
    return <OnboardingShell step={1}>{null}</OnboardingShell>;
  }

  if (sessionPending) {
    return <RouteFallback fullScreen />;
  }

  if (!preview && state === undefined) {
    if (isError) {
      return (
        <OnboardingShell step={1}>
          <OnboardingLoadState
            onRetry={() => {
              void refetch();
            }}
            retrying={isFetching}
            state="error"
          />
        </OnboardingShell>
      );
    }

    return <RouteFallback fullScreen />;
  }

  const step = preview ? 1 : (state?.step ?? 1);

  if (step > 1) {
    return <RouteFallback fullScreen />;
  }

  return (
    <OnboardingShell step={1}>
      <OnboardingWelcomeCard
        onContinue={async () => {
          if (!preview) {
            await finish.mutateAsync(1);
          }

          await navigate(`/onboarding/resume${suffix}`);
        }}
      />
    </OnboardingShell>
  );
}
