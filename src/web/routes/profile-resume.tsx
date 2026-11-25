import { copy } from "../../shared/copy.ts";
import { CoverLetterTemplateCard } from "../components/cover-letter-template-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ResumeSection } from "../components/resume-section.tsx";

export function ProfileResumePage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        titleNode={`${copy.nav.profilePages.resumeTitlePlain}${copy.nav.profilePages.resumeTitleItalic}`}
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-5">
          <ResumeSection />
        </div>
        <div className="min-w-0 xl:col-span-7">
          <CoverLetterTemplateCard />
        </div>
      </div>
    </div>
  );
}
