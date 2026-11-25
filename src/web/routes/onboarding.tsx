import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { RouteFallback } from "../components/route-fallback.tsx";
import { finishOnboardingStep, useOnboardingState } from "../lib/onboarding-api.ts";

export function OnboardingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const { data: state, isError, isFetching, refetch } = useOnboardingState();
  const recorded = useRef(false);

  useEffect(() => {
    if (preview) {
      void navigate(`/onboarding/resume${suffix}`, { replace: true });

      return;
    }

    if (state === undefined) {
      return;
    }

    if (state.step === 1) {
      if (recorded.current) {
        return;
      }

      recorded.current = true;

      const record = async () => {
        try {
          await finishOnboardingStep(1);
          await refetch();
        } catch {
          recorded.current = false;
        }
      };

      void record();

      return;
    }

    if (state.onboardedAt !== null) {
      void navigate("/home", { replace: true });

      return;
    }

    if (state.step >= 4) {
      void navigate("/onboarding/matches?trial=1", { replace: true });

      return;
    }

    if (state.step === 3) {
      void navigate("/onboarding/matches", { replace: true });

      return;
    }

    void navigate(state.resume === null ? "/onboarding/resume" : "/onboarding/targets", {
      replace: true,
    });
  }, [navigate, preview, refetch, state, suffix]);

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
