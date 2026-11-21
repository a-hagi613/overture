import { useEffect } from "react";
import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
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

  return (
    <OnboardingShell step={4}>
      {targets.data === undefined || state.data === undefined ? (
        <p className="mt-8 text-[13.5px] text-muted-foreground">
          {targets.isPending || state.isPending ? "" : copy.onboarding.loadFailed}
        </p>
      ) : (
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
      )}
    </OnboardingShell>
  );
}
