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
  labels?: readonly string[];
  step: number;
}) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && session === null) {
      void navigate("/signin");
    }
  }, [navigate, session, isPending]);

  if (isPending) {
    return <RouteFallback fullScreen />;
  }

  if (session === null) {
    return <RouteFallback fullScreen />;
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      <Backdrop />
      <div className="relative z-10 flex min-h-screen flex-col">
        <OnboardingStepHeader />
        <main
          className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-4 outline-none sm:px-6"
          id="main-content"
          tabIndex={-1}
        >
          <div className="text-center">
            <h1 className={dsPageTitle}>
              {`${copy.onboarding.setupTitlePlain} `}
              <em className="italic text-signal">{copy.onboarding.setupTitleItalic}</em>
            </h1>
            <p className={`${dsBody} mx-auto mt-2 max-w-lg`}>{copy.onboarding.setupIntro}</p>
          </div>
          <OnboardingStepRail labels={labels ?? copy.onboarding.steps} step={step} />
          {children}
        </main>
      </div>
    </div>
  );
}
