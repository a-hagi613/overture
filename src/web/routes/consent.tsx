import { copy } from "../../shared/copy.ts";
import { ConsentCard } from "../components/consent-card.tsx";
import { ConsentEarlierVersions } from "../components/consent-earlier-versions.tsx";
import { LegalShell } from "../components/legal-shell.tsx";
import { Card } from "../components/ui/card.tsx";
import { useConsent, useConsentVersions } from "../lib/consent-api.ts";

export function ConsentPage() {
  const consent = useConsent();
  const versions = useConsentVersions(consent.data !== undefined);
  const earlier = versions.data?.slice(1) ?? [];

  return (
    <LegalShell>
      {consent.isPending ? (
        <Card className="h-80 animate-pulse p-6" variant="muted">
          <span className="sr-only">{copy.onboarding.loading}</span>
        </Card>
      ) : null}
      {consent.isError ? (
        <Card className="p-6" variant="muted">
          <p className="text-sm text-muted-foreground">{copy.consent.unavailable}</p>
        </Card>
      ) : null}
      {consent.data === undefined ? null : <ConsentCard state={consent.data} />}
      {earlier.length > 0 ? <ConsentEarlierVersions versions={earlier} /> : null}
    </LegalShell>
  );
}
