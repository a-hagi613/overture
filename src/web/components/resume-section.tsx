import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { PdfPreview } from "./pdf-preview.tsx";

export function ResumeSection() {
  const { resume } = copy.profile;

  return (
    <Section id="profile-resume" labelledBy="profile-resume-heading">
      <SectionHead
        folio={resume.folio}
        headingId="profile-resume-heading"
        intro={resume.sub}
        title={copy.profile.tabs.resume}
      />
      <div className="mt-[22px] flex flex-wrap items-start gap-y-7 min-[768px]:gap-x-10">
        <div className="w-full min-w-0 basis-[320px] max-[767px]:max-w-full md:max-w-[340px]">
          <PdfPreview />
        </div>
        <div className="min-w-0 flex-[1_1_340px]">
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="flex h-[52px] w-11 flex-none items-end justify-center rounded border-[1.5px] border-foreground pb-1.5 text-[10px] leading-[normal] font-semibold tracking-[.08em]"
            >
              {resume.chip}
            </span>
            <div className="min-w-0">
              <p className="break-words font-mono text-sm">{resume.fileName}</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
                {resume.meta}
              </p>
            </div>
          </div>
          <div className="mt-[22px] flex items-start gap-3.5 rounded-lg border border-border bg-muted p-4 px-[18px]">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-ok-soft text-ok"
            >
              <NavGlyph name="check" size={16} />
            </span>
            <div>
              <p className="text-[14.5px] font-semibold">{resume.strongNote}</p>
              <p className="mt-[3px] max-w-[52ch] text-[13.5px] text-muted-foreground">
                {resume.note}
              </p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-5">
            <div className="border-t border-border py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[.15em] leading-[normal] text-muted-foreground">
                {resume.sentWith}
              </dt>
              <dd className="mt-1 text-sm leading-[1.5] font-semibold tabular-nums">
                {resume.sentWithValue}
              </dd>
            </div>
            <div className="border-t border-border py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[.15em] leading-[normal] text-muted-foreground">
                {resume.factsRead}
              </dt>
              <dd className="mt-1 text-sm leading-[1.5] font-semibold tabular-nums">
                {resume.factsReadValue}
              </dd>
            </div>
          </dl>
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-card px-4 text-[13.5px] leading-[normal] font-semibold hover:bg-muted"
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
                viewBox="0 0 24 24"
                width="16"
              >
                <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
              </svg>
              {resume.replace}
            </button>
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3.5 text-[13.5px] leading-[normal] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              href="#profile-resume"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
                viewBox="0 0 24 24"
                width="16"
              >
                <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
              </svg>
              {resume.download}
            </a>
          </div>
          <p className="mt-3 max-w-[52ch] text-[12.5px] text-muted-foreground">
            {resume.newFileNote}
          </p>
        </div>
      </div>
    </Section>
  );
}
