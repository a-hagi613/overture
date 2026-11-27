import { copy } from "../../shared/copy.ts";
import { CoverLetterTemplateCard } from "../components/cover-letter-template-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ResumeSection } from "../components/resume-section.tsx";

export function ProfileResumePage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <PageHeader
        titleNode={`${copy.nav.profilePages.resumeTitlePlain}${copy.nav.profilePages.resumeTitleItalic}`}
      />
      <div className="grid min-w-0 grid-cols-1 items-start gap-5">
        <ResumeSection />
        <CoverLetterTemplateCard />
      </div>
    </div>
  );
}
