import { copy } from "../../shared/copy.ts";
import { useConsent } from "../lib/consent-api.ts";
import { longDate } from "../lib/consent-format.ts";
import { SettingsLegalRow } from "./settings-legal-row.tsx";

export function SettingsLegal() {
  const consent = useConsent();
  const accepted = consent.data?.accepted ?? null;
  const version = consent.data?.current.version;

  const consentDetail =
    version === undefined
      ? copy.settings.legalConsentNotAgreed
      : [
          copy.settings.legalConsentVersion(version),
          accepted === null
            ? copy.settings.legalConsentNotAgreed
            : copy.settings.legalConsentAccepted(longDate(accepted.at)),
        ].join(copy.settings.legalSeparator);

  return (
    <section
      aria-labelledby="settings-legal"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh min-[900px]:col-span-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[26px] leading-[1.1]" id="settings-legal">
          {copy.settings.legalHeading}
        </h2>
        <span className="font-serif text-sm italic text-muted-foreground">
          {copy.settings.legalFolio}
        </span>
      </div>
      <div className="mt-2.5">
        <SettingsLegalRow
          detail={copy.settings.legalTermsDetail}
          label={copy.settings.legalTerms}
          linkText={copy.settings.legalOpen}
          to="/terms"
        />
        <SettingsLegalRow
          detail={copy.settings.legalPrivacyDetail}
          label={copy.settings.legalPrivacy}
          linkText={copy.settings.legalOpen}
          to="/privacy"
        />
        <SettingsLegalRow
          detail={consentDetail}
          label={copy.settings.legalConsent}
          linkText={copy.settings.legalConsentRead}
          to="/consent"
        />
      </div>
    </section>
  );
}
