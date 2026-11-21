import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { OnboardingForwardCard } from "../components/onboarding-forward-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { acceptConsent, useConsent } from "../lib/consent-api.ts";
import { startOnboarding, stateKey, useOnboardingMailbox } from "../lib/onboarding-api.ts";

export function OnboardingForwardPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const mailbox = useOnboardingMailbox();
  const consent = useConsent();

  const ready = mailbox.data !== undefined && consent.data !== undefined;
  const failed = mailbox.isError || consent.isError;

  return (
    <OnboardingShell step={5}>
      {ready ? (
        <OnboardingForwardCard
          address={mailbox.data.address}
          alreadyAgreed={consent.data.accepted?.version === consent.data.current.version}
          forwardingWorks={mailbox.data.forwardingWorks}
          onStart={async () => {
            await acceptConsent(consent.data.current.version);
            client.setQueryData(stateKey, await startOnboarding());
            await navigate("/notifications");
          }}
        />
      ) : (
        <p className="mt-8 text-[13.5px] text-muted-foreground" role={failed ? "alert" : undefined}>
          {failed ? copy.onboarding.forward.loadFailed : ""}
        </p>
      )}
    </OnboardingShell>
  );
}
