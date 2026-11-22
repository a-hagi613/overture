import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { OnboardingTrialCard } from "../components/onboarding-trial-card.tsx";
import type { TrialCardState } from "../components/onboarding-trial-card.tsx";
import { authClient } from "../lib/auth-client.ts";
import { startCardSetup, verifyTrialCard } from "../lib/trial-api.ts";

const text = copy.onboarding.trial;

export function OnboardingTrialPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const [state, setState] = useState<TrialCardState>("verify");
  const sessionId = params.get("session");
  const returned = params.get("card") === "verified" && sessionId !== null;

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    }
  }, [navigate, session, isPending]);

  const verify = useMutation({
    mutationFn: async () => {
      if (!returned) {
        globalThis.location.assign(await startCardSetup());

        return "redirect" as const;
      }

      return verifyTrialCard(sessionId);
    },
    onSuccess: async (outcome) => {
      if (outcome === "granted") {
        await navigate("/notifications");

        return;
      }

      if (outcome !== "redirect") {
        setState(outcome);
      }
    },
  });

  const restart = useMutation({
    mutationFn: async () => {
      globalThis.location.assign(await startCardSetup());
    },
  });

  return (
    <div className="board onb min-h-screen overflow-x-clip">
      <Backdrop />
      <div className="relative z-[1]">
        <main className="ob outline-none" id="main" tabIndex={-1}>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1 className="serif hd2 mt-2.5">
            {text.titlePlain} <span className="italic">{text.titleItalic}</span> {text.titleRest}
          </h1>
          <p className="serif mt-1.5 italic text-muted-foreground">{text.kicker}</p>
          <div className="mt-5 max-w-[760px]">
            <OnboardingTrialCard
              busy={verify.isPending || restart.isPending}
              error={verify.isError || restart.isError}
              onVerify={state === "verify" ? verify.mutate : restart.mutate}
              state={state}
            />
          </div>
          <div className="mt-6 flex justify-end">
            <button className="btn" disabled style={{ minHeight: 44 }} type="button">
              {text.startButton}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
