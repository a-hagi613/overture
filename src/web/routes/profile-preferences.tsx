import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { TargetsSection } from "../components/targets-section.tsx";

export function ProfilePreferencesPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        titleNode={`${copy.nav.profilePages.preferencesTitlePlain}${copy.nav.profilePages.preferencesTitleItalic}`}
      />
      <div className="min-w-0 max-w-4xl">
        <TargetsSection />
      </div>
    </div>
  );
}
