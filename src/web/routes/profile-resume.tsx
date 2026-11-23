import { copy } from "../../shared/copy.ts";
import { CoverLetterTemplateCard } from "../components/cover-letter-template-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ResumeSection } from "../components/resume-section.tsx";

export function ProfileResumePage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        lead={copy.nav.profilePages.resumeLead}
        titleNode={
          <>
            {copy.nav.profilePages.resumeTitlePlain}
            <em className="italic text-signal">{copy.nav.profilePages.resumeTitleItalic}</em>
          </>
        }
      />
      <ResumeSection />
      <CoverLetterTemplateCard />
    </div>
  );
}
