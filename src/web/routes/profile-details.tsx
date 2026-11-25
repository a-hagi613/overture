import { copy } from "../../shared/copy.ts";
import { AddressSection } from "../components/address-section.tsx";
import { FactsSection } from "../components/facts-section.tsx";
import { PageHeader } from "../components/page-header.tsx";

export function ProfileDetailsPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        titleNode={`${copy.nav.profilePages.detailsTitlePlain}${copy.nav.profilePages.detailsTitleItalic}`}
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <FactsSection />
        </div>
        <div className="min-w-0 xl:col-span-4">
          <AddressSection />
        </div>
      </div>
    </div>
  );
}
