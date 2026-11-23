import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import type { TrialCardState } from "../components/onboarding-trial-card.tsx";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { OnboardingStepHeader } from "../components/onboarding-step-header.tsx";
import { OnboardingTrialCard } from "../components/onboarding-trial-card.tsx";
import { Button } from "../components/ui/button.tsx";
import { dsBody, dsEyebrow, dsPageTitle } from "../components/ui/ds.ts";
import { authClient } from "../lib/auth-client.ts";
import { startCardSetup, verifyTrialCard } from "../lib/trial-api.ts";

const text = copy.onboarding.trial;

export function OnboardingTrialPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
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
      if (preview) {
        return "granted" as const;
      }

      if (!returned) {
        globalThis.location.assign(await startCardSetup());

        return "redirect" as const;
      }

      return verifyTrialCard(sessionId);
    },
    onSuccess: async (outcome) => {
      if (outcome === "granted") {
        if (preview) {
          toast.success("Trial verification preview complete.");
        }

        await navigate("/home");

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
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      <Backdrop />
      <div className="relative z-10 flex min-h-screen flex-col">
        <OnboardingStepHeader />
        <main
          className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6 outline-none sm:px-6"
          id="main-content"
          tabIndex={-1}
        >
          <p className={dsEyebrow}>{text.eyebrow}</p>
          <h1 className={`${dsPageTitle} mt-2`}>
            {`${text.titlePlain} `}
            <em className="italic text-signal">{text.titleItalic}</em>
            {` ${text.titleRest}`}
          </h1>
          <p className={`${dsBody} mt-2`}>{text.kicker}</p>
          <div className="mt-6">
            <OnboardingTrialCard
              backTo={`/onboarding/forward${suffix}`}
              busy={verify.isPending || restart.isPending}
              error={verify.isError || restart.isError}
              onVerify={state === "verify" ? verify.mutate : restart.mutate}
              state={state}
            />
          </div>
          <div className="mt-6 flex justify-end">
            <Button disabled size="default" variant="primary">
              {text.startButton}
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
