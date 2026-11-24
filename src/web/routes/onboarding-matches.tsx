import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { OnboardingLoadState } from "../components/onboarding-load-state.tsx";
import { OnboardingMatchesCard } from "../components/onboarding-matches-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import {
  useFinishOnboardingStep,
  useOnboardingMatches,
  useOnboardingState,
  useSaveOnboardingMatches,
} from "../lib/onboarding-api.ts";

export function OnboardingMatchesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const state = useOnboardingState();
  const matches = useOnboardingMatches();
  const save = useSaveOnboardingMatches();
  const finish = useFinishOnboardingStep();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    if (preview || state.data === undefined) {
      return;
    }

    if (state.data.step >= 4) {
      void navigate("/onboarding/trial", { replace: true });
    } else if (state.data.step < 2) {
      void navigate("/onboarding/resume", { replace: true });
    }
  }, [navigate, preview, state.data]);

  const picks = selected ?? matches.data?.selected ?? [];
  const busy = save.isPending || continuing;

  const toggle = (id: string) => {
    if (preview) {
      setSelected(picks.includes(id) ? picks.filter((pick) => pick !== id) : [...picks, id]);

      return;
    }

    const next = picks.includes(id)
      ? picks.filter((pick) => pick !== id)
      : [...picks, id].slice(0, matches.data?.pickLimit ?? 3);

    setSelected(next);
    save.mutate(next);
  };

  const continueOn = async () => {
    if (continuing) {
      return;
    }

    setContinuing(true);

    if (!preview) {
      try {
        await finish.mutateAsync(3);
      } catch {
        setContinuing(false);

        return;
      }
    }

    await navigate(`/onboarding/trial${suffix}`);
  };

  if (matches.data === undefined) {
    return (
      <OnboardingShell step={3}>
        <OnboardingLoadState
          onRetry={() => {
            void matches.refetch();
          }}
          retrying={matches.isFetching}
          state={matches.isError ? "error" : "loading"}
        />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={3}>
      <OnboardingMatchesCard
        backTo={`/onboarding/targets${suffix}`}
        busy={busy}
        failed={save.isError}
        matches={matches.data}
        onContinue={continueOn}
        onToggle={toggle}
        selected={picks}
      />
    </OnboardingShell>
  );
}
