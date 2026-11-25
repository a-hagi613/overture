import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

export function AccountLegalCard() {
  const rows = [
    {
      detail: copy.settings.legalTermsDetail,
      label: copy.settings.legalTerms,
      linkText: copy.settings.legalOpen,
      to: "/terms",
    },
    {
      detail: copy.settings.legalPrivacyDetail,
      label: copy.settings.legalPrivacy,
      linkText: copy.settings.legalOpen,
      to: "/privacy",
    },
    {
      detail: copy.settings.legalConsentDetail,
      label: copy.settings.legalConsent,
      linkText: copy.settings.legalOpen,
      to: "/consent",
    },
  ] as const;

  return (
    <div id="legal">
      <Card ariaLabelledBy="account-legal-heading" className="p-5 md:p-6">
        <h2 className={dsCardTitle} id="account-legal-heading">
          {copy.settings.legalHeading}
        </h2>

        <div className="mt-3">
          {rows.map((row) => (
            <div
              className="flex items-center justify-between gap-4 border-t border-border py-3.5 first:border-t-0"
              key={row.to}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{row.label}</p>
                <p className={`${dsBody} mt-0.5`}>{row.detail}</p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={row.to}>{row.linkText}</Link>
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
