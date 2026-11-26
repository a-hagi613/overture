import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { Backdrop } from "./backdrop.tsx";
import { OnboardingStepHeader } from "./onboarding-step-header.tsx";
import { OnboardingStepRail } from "./onboarding-step-rail.tsx";
import { RouteFallback } from "./route-fallback.tsx";
import { dsBody, dsPageTitle } from "./ui/ds.ts";

export function OnboardingShell({
  children,
  labels,
  step,
}: {
  children: ReactNode;
  labels?: readonly string[] | undefined;
  step: 1 | 2 | 3 | 4;
}) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    }
  }, [navigate, session, isPending]);

  if (isPending || session === null) {
    return <RouteFallback fullScreen />;
  }

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
          <div>
            <h1 className={dsPageTitle}>{copy.onboarding.setupTitlePlain}</h1>
            <p className={`${dsBody} mt-1`}>{copy.onboarding.setupIntro}</p>
          </div>
          <OnboardingStepRail labels={labels ?? copy.onboarding.steps} step={step} />
          {children}
        </main>
      </div>
    </div>
  );
}
