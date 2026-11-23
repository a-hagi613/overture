import { copy } from "../../shared/copy.ts";
import { AddressSection } from "../components/address-section.tsx";
import { FactsSection } from "../components/facts-section.tsx";
import { PageHeader } from "../components/page-header.tsx";

export function ProfileDetailsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        lead={copy.nav.profilePages.detailsLead}
        titleNode={
          <>
            {copy.nav.profilePages.detailsTitlePlain}
            <em className="italic text-signal">{copy.nav.profilePages.detailsTitleItalic}</em>
          </>
        }
      />
      <FactsSection />
      <AddressSection />
    </div>
  );
}
