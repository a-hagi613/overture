import { copy } from "../../shared/copy.ts";
import { CoverLetterTemplateCard } from "../components/cover-letter-template-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ResumeSection } from "../components/resume-section.tsx";

export function ProfileResumePage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 xl:h-full xl:overflow-hidden">
      <PageHeader
        titleNode={`${copy.nav.profilePages.resumeTitlePlain}${copy.nav.profilePages.resumeTitleItalic}`}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-5 xl:max-h-[700px] xl:grid-cols-12">
        <div className="flex min-h-0 min-w-0 flex-col xl:col-span-5">
          <ResumeSection />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col xl:col-span-7">
          <CoverLetterTemplateCard />
        </div>
      </div>
    </div>
  );
}
