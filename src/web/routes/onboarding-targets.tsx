import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingTargetsCard } from "../components/onboarding-targets-card.tsx";
import {
  matchesKey,
  useFinishOnboardingStep,
  useOnboardingState,
  useOnboardingTargets,
  useSaveCurrentEmployer,
  useSaveOnboardingSkipCompanies,
  useSaveOnboardingTargets,
  useSaveOnboardingTimezone,
} from "../lib/onboarding-api.ts";

export function OnboardingTargetsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const state = useOnboardingState();
  const targets = useOnboardingTargets();
  const save = useSaveOnboardingTargets();
  const saveCurrentEmployer = useSaveCurrentEmployer();
  const saveSkip = useSaveOnboardingSkipCompanies();
  const saveTimezone = useSaveOnboardingTimezone();
  const finish = useFinishOnboardingStep();

  const { mutate: persistTimezone } = saveTimezone;

  useEffect(() => {
    if (preview) {
      return;
    }

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (zone !== "") {
      persistTimezone(zone);
    }
  }, [persistTimezone, preview]);

  useEffect(() => {
    if (preview || state.data === undefined) {
      return;
    }

    if (state.data.onboardedAt !== null) {
      void navigate("/home", { replace: true });
    }
  }, [navigate, preview, state.data]);

  const retry = () => {
    void targets.refetch();
    void state.refetch();
  };

  if (targets.data === undefined || state.data === undefined) {
    return (
      <OnboardingShell step={2}>
        <OnboardingLoadState
          onRetry={retry}
          retrying={targets.isFetching || state.isFetching}
          state={targets.isError || state.isError ? "error" : "loading"}
        />
      </OnboardingShell>
    );
  }

  const { choices, targets: saved } = targets.data;

  const nothingToPick =
    choices.roles.length === 0 &&
    choices.locations.length === 0 &&
    saved.roles.length === 0 &&
    saved.locations.length === 0;

  if (nothingToPick) {
    return (
      <OnboardingShell step={2}>
        <OnboardingLoadState
          onRetry={retry}
          retrying={targets.isFetching || state.isFetching}
          state="empty"
        />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={2}>
      <OnboardingTargetsCard
        backTo={`/onboarding/resume${suffix}`}
        currentEmployer={state.data.currentEmployer}
        onContinue={async () => {
          if (!preview) {
            if (state.data.resume === null) {
              await navigate("/onboarding/resume", { replace: true });

              return;
            }

            await finish.mutateAsync(2);
          }

          queryClient.removeQueries({ queryKey: matchesKey });
          await navigate(`/onboarding/matches${suffix}`);
        }}
        preview={preview}
        save={async (next) =>
          preview ? { ...targets.data, targets: next } : save.mutateAsync(next)
        }
        saveCurrentEmployer={async (name) => {
          if (!preview) {
            await saveCurrentEmployer.mutateAsync(name);
          }
        }}
        saveSkip={async (companies) =>
          preview
            ? {
                companies: companies.map((item, idx) => ({
                  domain: item.domain,
                  id: `preview-${String(idx)}`,
                  name: item.name,
                  reason: "user",
                })),
              }
            : saveSkip.mutateAsync(companies)
        }
        skipCompanies={state.data.skipCompanies}
        view={targets.data}
      />
    </OnboardingShell>
  );
}
