import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { AddressSection } from "../components/address-section.tsx";
import { FactsSection } from "../components/facts-section.tsx";
import { ResumeSection } from "../components/resume-section.tsx";
import { SkipSection } from "../components/skip-section.tsx";
import { TargetsSection } from "../components/targets-section.tsx";

const tabs = [
  { key: "resume", section: "profile-resume" },
  { key: "facts", section: "profile-facts" },
  { key: "targets", section: "profile-targets" },
  { key: "skipList", section: "profile-skip" },
  { key: "address", section: "profile-address" },
] as const;

export function ProfilePage() {
  return (
    <div>
      <PageHeader
        lead={copy.profile.lead}
        titleNode={
          <>
            {copy.profile.titlePlain} <span className="italic">{copy.profile.titleItalic}</span>
          </>
        }
      />
      <nav
        aria-label={copy.profile.sectionsLabel}
        className="mt-[26px] flex gap-x-[26px] overflow-x-auto overflow-y-hidden border-b border-border"
        data-scroll-region
      >
        {tabs.map((tab) => (
          <a
            className="-mb-px flex min-h-11 flex-none items-center gap-2 border-b-2 border-transparent text-[13.5px] leading-[normal] font-semibold text-muted-foreground hover:border-input hover:text-foreground"
            href={`#${tab.section}`}
            key={tab.key}
          >
            <span className="font-serif text-[17px] leading-[normal] font-normal italic text-muted-foreground">
              {copy.profile.tabs.ordinals[tab.key]}
            </span>
            {copy.profile.tabs[tab.key]}
          </a>
        ))}
      </nav>
      <ResumeSection />
      <FactsSection />
      <TargetsSection />
      <SkipSection />
      <AddressSection />
    </div>
  );
}
