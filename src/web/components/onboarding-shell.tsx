import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { Backdrop } from "./backdrop.tsx";
import { OnboardingStepHeader } from "./onboarding-step-header.tsx";
import { OnboardingStepRail } from "./onboarding-step-rail.tsx";

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

  return (
    <div className="board onb min-h-screen overflow-x-clip">
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
          <OnboardingStepRail labels={labels ?? copy.onboarding.steps} step={step} />
          {children}
        </main>
      </div>
    </div>
  );
}
