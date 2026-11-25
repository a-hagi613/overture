import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { SkipSection } from "../components/skip-section.tsx";
import { TargetsSection } from "../components/targets-section.tsx";

export function ProfilePreferencesPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        titleNode={`${copy.nav.profilePages.preferencesTitlePlain}${copy.nav.profilePages.preferencesTitleItalic}`}
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <TargetsSection />
        </div>
        <div className="min-w-0 xl:col-span-4">
          <SkipSection />
        </div>
      </div>
    </div>
  );
}
