import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { OnboardingForwardCard } from "../components/onboarding-forward-card.tsx";
import { OnboardingShell } from "../components/onboarding-shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { useAcceptConsent, useConsent } from "../lib/consent-api.ts";
import { useOnboardingMailbox, useStartOnboarding } from "../lib/onboarding-api.ts";

export function OnboardingForwardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preview = params.get("preview") === "1";
  const suffix = preview ? "?preview=1" : "";
  const mailbox = useOnboardingMailbox();
  const consent = useConsent();
  const acceptConsentMutation = useAcceptConsent();
  const startOnboardingMutation = useStartOnboarding();

  const ready = preview || (mailbox.data !== undefined && consent.data !== undefined);
  const failed = !preview && (mailbox.isError || consent.isError);
  const retrying = mailbox.isFetching || consent.isFetching;
  const address = mailbox.data?.address ?? copy.profile.address.alias;

  const alreadyAgreed =
    consent.data === undefined
      ? false
      : consent.data.accepted?.version === consent.data.current.version;

  const retryLoad = () => {
    void mailbox.refetch();
    void consent.refetch();
  };

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
              await acceptConsentMutation.mutateAsync(consent.data.current.version);
            }

            await startOnboardingMutation.mutateAsync();
            await navigate("/home");
          }}
        />
      ) : (
        <Card className="p-6" variant="elevated">
          <div role={failed ? "alert" : undefined}>
            <p className="text-sm text-muted-foreground">
              {failed ? copy.onboarding.forward.loadFailed : copy.onboarding.loading}
            </p>
            {failed ? (
              <Button
                className="mt-4"
                disabled={retrying}
                onClick={retryLoad}
                size="default"
                variant="primary"
              >
                {retrying ? copy.onboarding.retrying : copy.onboarding.retry}
              </Button>
            ) : null}
          </div>
        </Card>
      )}
    </OnboardingShell>
  );
}
