import { copy } from "../../shared/copy.ts";
import { FactsSection } from "../components/facts-section.tsx";
import { PageHeader } from "../components/page-header.tsx";

export function ProfileDetailsPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        titleNode={`${copy.nav.profilePages.detailsTitlePlain}${copy.nav.profilePages.detailsTitleItalic}`}
      />
      <div className="mx-auto w-full max-w-3xl">
        <FactsSection />
      </div>
    </div>
  );
}
