import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { OnboardingForwardCard } from "../components/onboarding-forward-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { Card } from "../components/ui/card.tsx";
import { acceptConsent, useConsent } from "../lib/consent-api.ts";
import { startOnboarding, stateKey, useOnboardingMailbox } from "../lib/onboarding-api.ts";

export function OnboardingForwardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const client = useQueryClient();
  const mailbox = useOnboardingMailbox();
  const consent = useConsent();

  const ready = preview || (mailbox.data !== undefined && consent.data !== undefined);
  const failed = !preview && (mailbox.isError || consent.isError);
  const address = mailbox.data?.address ?? copy.profile.address.alias;

  const alreadyAgreed =
    consent.data === undefined
      ? false
      : consent.data.accepted?.version === consent.data.current.version;

  return (
    <OnboardingShell step={5}>
      {ready ? (
        <OnboardingForwardCard
          address={address}
          alreadyAgreed={alreadyAgreed}
          backTo={`/onboarding/targets${suffix}`}
          forwardingWorks={mailbox.data?.forwardingWorks ?? false}
          onStart={async () => {
            if (preview) {
              toast.success("Onboarding preview complete.");
              await navigate(`/onboarding/trial${suffix}`);

              return;
            }

            if (consent.data !== undefined) {
              await acceptConsent(consent.data.current.version);
            }

            client.setQueryData(stateKey, await startOnboarding());
            await navigate("/home");
          }}
        />
      ) : (
        <Card className="p-6" variant="elevated">
          <p className="text-sm text-muted-foreground" role={failed ? "alert" : undefined}>
            {failed ? copy.onboarding.forward.loadFailed : copy.onboarding.loading}
          </p>
        </Card>
      )}
    </OnboardingShell>
  );
}
