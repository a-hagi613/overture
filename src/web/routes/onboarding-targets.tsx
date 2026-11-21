import { useEffect } from "react";
import { useNavigate } from "react-router";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { OnboardingTargetsCard } from "../components/onboarding-targets-card.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingState,
  useOnboardingTargets,
  useSaveOnboardingTargets,
  useSaveOnboardingTimezone,
} from "../lib/onboarding-api.ts";
import { saveSkipCompanies } from "../lib/profile-api.ts";

export function OnboardingTargetsPage() {
  const navigate = useNavigate();
  const state = useOnboardingState();
  const targets = useOnboardingTargets();
  const save = useSaveOnboardingTargets();
  const saveTimezone = useSaveOnboardingTimezone();
  const finish = useFinishOnboardingStep();

  const { mutate: persistTimezone } = saveTimezone;

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (zone !== "") {
      persistTimezone(zone);
    }
  }, [persistTimezone]);

  const retry = () => {
    void targets.refetch();
    void state.refetch();
  };

  if (targets.data === undefined || state.data === undefined) {
    return (
      <OnboardingShell step={4}>
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
      <OnboardingShell step={4}>
        <OnboardingLoadState
          onRetry={retry}
          retrying={targets.isFetching || state.isFetching}
          state="empty"
        />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={4}>
      <OnboardingTargetsCard
        backTo="/onboarding/facts"
        onContinue={async () => {
          await finish.mutateAsync(4);
          await navigate("/profile#profile-targets");
        }}
        save={async (next) => save.mutateAsync(next)}
        saveSkip={saveSkipCompanies}
        skipCompanies={state.data.skipCompanies}
        view={targets.data}
      />
    </OnboardingShell>
  );
}
