import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { SkipSection } from "../components/skip-section.tsx";
import { TargetsSection } from "../components/targets-section.tsx";

export function ProfilePreferencesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        lead={copy.nav.profilePages.preferencesLead}
        titleNode={
          <>
            {copy.nav.profilePages.preferencesTitlePlain}
            <em className="italic text-signal">{copy.nav.profilePages.preferencesTitleItalic}</em>
          </>
        }
      />
      <TargetsSection />
      <SkipSection />
    </div>
  );
}
