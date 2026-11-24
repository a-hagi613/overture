import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import type { TrialCardState } from "../components/onboarding-trial-card.tsx";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { OnboardingStepHeader } from "../components/onboarding-step-header.tsx";
import { OnboardingStepRail } from "../components/onboarding-step-rail.tsx";
import { OnboardingTrialCard } from "../components/onboarding-trial-card.tsx";
import { Button } from "../components/ui/button.tsx";
import { dsBody, dsEyebrow, dsPageTitle } from "../components/ui/ds.ts";
import { authClient } from "../lib/auth-client.ts";
import { useAcceptConsent, useConsent } from "../lib/consent-api.ts";
import { fetchOnboardingMatches, usePrepareOnboarding } from "../lib/onboarding-api.ts";
import { startCardSetup, verifyTrialCard } from "../lib/trial-api.ts";

const text = copy.onboarding.trial;

export function OnboardingTrialPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const { data: session, isPending } = authClient.useSession();
  const consent = useConsent();
  const acceptConsent = useAcceptConsent();
  const prepare = usePrepareOnboarding();
  const [state, setState] = useState<TrialCardState>("verify");
  const [agreed, setAgreed] = useState(false);
  const sessionId = params.get("session");
  const returned = params.get("card") === "verified" && sessionId !== null;

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    }
  }, [navigate, session, isPending]);

  const alreadyAgreed =
    consent.data === undefined
      ? false
      : consent.data.accepted?.version === consent.data.current.version;

  const agreedNow = agreed || alreadyAgreed || returned;

  const preparePicked = async () => {
    const { selected } = await fetchOnboardingMatches();

    if (selected.length === 0) {
      return 0;
    }

    const result = await prepare.mutateAsync(selected);

    return result.prepared;
  };

  const verify = useMutation({
    mutationFn: async () => {
      if (preview) {
        return "granted" as const;
      }

      if (consent.data !== undefined && !alreadyAgreed) {
        await acceptConsent.mutateAsync(consent.data.current.version);
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
          await navigate("/ready");

          return;
        }

        const prepared = await preparePicked();

        if (prepared === 0) {
          toast.error(copy.onboarding.matches.prepareFailed);
          await navigate(`/onboarding/matches${suffix}`);

          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["home"] }),
          queryClient.invalidateQueries({ queryKey: ["billing"] }),
          queryClient.invalidateQueries({ queryKey: ["onboarding-state"] }),
          queryClient.invalidateQueries({ queryKey: ["nav"] }),
          queryClient.invalidateQueries({ queryKey: ["ready"] }),
          queryClient.invalidateQueries({ queryKey: ["board"] }),
        ]);

        await navigate("/ready");

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

  const verifyDisabled =
    (state === "verify" && !returned && !agreedNow) ||
    (!preview && consent.data === undefined && !returned);

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
          <OnboardingStepRail step={4} />
          <div className="mb-4 rounded-xl border border-border bg-card p-4">
            <label className="flex items-start gap-2.5 text-xs leading-relaxed text-foreground">
              <input
                checked={agreedNow}
                className="mt-0.5 h-4 w-4 flex-none accent-signal"
                onChange={(event) => {
                  setAgreed(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <span>
                {text.consentBefore}
                <Link
                  className="underline decoration-input underline-offset-4 hover:text-signal-text"
                  to="/terms"
                >
                  {text.consentTerms}
                </Link>
                {text.consentBetween}
                <Link
                  className="underline decoration-input underline-offset-4 hover:text-signal-text"
                  to="/privacy"
                >
                  {text.consentPrivacy}
                </Link>
                {text.consentAfter}
              </span>
            </label>
          </div>
          <OnboardingTrialCard
            backTo={`/onboarding/matches${suffix}`}
            busy={verify.isPending || restart.isPending || prepare.isPending}
            disabled={verifyDisabled}
            error={verify.isError || restart.isError || prepare.isError}
            onVerify={state === "verify" ? verify.mutate : restart.mutate}
            state={state}
          />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button asChild size="default" variant="ghost">
              <Link to={`/onboarding/matches${suffix}`}>
                <ArrowLeft aria-hidden="true" size={15} />
                <span>{text.backButton}</span>
              </Link>
            </Button>
            {verifyDisabled && state === "verify" ? (
              <output className="text-xs font-semibold text-need">{text.consentRequired}</output>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
