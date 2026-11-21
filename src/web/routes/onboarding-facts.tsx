import { useEffect } from "react";
import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { OnboardingFactsCard } from "../components/onboarding-facts-card.tsx";
import { OnboardingStepHeader } from "../components/onboarding-step-header.tsx";
import { OnboardingStepRail } from "../components/onboarding-step-rail.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useOnboardingFacts, useSaveOnboardingFacts } from "../lib/onboarding-api.ts";

export function OnboardingFactsPage() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { data, isPending } = useOnboardingFacts();
  const mutation = useSaveOnboardingFacts();

  useEffect(() => {
    if (!sessionPending && session === null) {
      void navigate("/signin");
    }
  }, [navigate, session, sessionPending]);

  return (
    <div className="board onb min-h-screen">
      <Backdrop />
      <div className="relative z-[1]">
        <OnboardingStepHeader />
        <main className="ob">
          <div className="text-center">
            <h1 className="serif hd2">
              {copy.onboarding.setupTitlePlain}{" "}
              <span className="italic">{copy.onboarding.setupTitleItalic}</span>
            </h1>
            <p className="mx-auto mt-2.5 max-w-[46ch] text-[14.5px] text-muted-foreground">
              {copy.onboarding.setupIntro}
            </p>
          </div>
          <OnboardingStepRail />
          {data === undefined ? (
            <p className="mt-8 text-[13.5px] text-muted-foreground">
              {isPending ? "" : copy.onboarding.loadFailed}
            </p>
          ) : (
            <OnboardingFactsCard
              onContinue={() => {
                void navigate("/profile#profile-facts");
              }}
              save={async (input) => mutation.mutateAsync(input)}
              view={data}
            />
          )}
        </main>
      </div>
    </div>
  );
}
