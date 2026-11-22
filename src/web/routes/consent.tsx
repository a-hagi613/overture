import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { ConsentCard } from "../components/consent-card.tsx";
import { ConsentEarlierVersions } from "../components/consent-earlier-versions.tsx";
import { LegalTopBar } from "../components/legal-top-bar.tsx";
import { useConsent, useConsentVersions } from "../lib/consent-api.ts";

export function ConsentPage() {
  const consent = useConsent();
  const versions = useConsentVersions(consent.data !== undefined);
  const earlier = versions.data?.slice(1) ?? [];

  return (
    <div className="legal-surface relative min-h-screen overflow-hidden bg-background text-foreground">
      <Backdrop />
      <div className="relative z-[1] flex min-h-screen flex-col">
        <LegalTopBar />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[620px] px-[clamp(18px,4vw,40px)] pt-[8px] pb-[56px] outline-none"
        >
          {consent.isPending ? <div className="h-[382px]" /> : null}
          {consent.isError ? (
            <p className="text-sm text-muted-foreground">{copy.consent.unavailable}</p>
          ) : null}
          {consent.data === undefined ? null : <ConsentCard state={consent.data} />}
          {earlier.length > 0 ? <ConsentEarlierVersions versions={earlier} /> : null}
        </main>
      </div>
    </div>
  );
}
