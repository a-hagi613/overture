import { useRef } from "react";
import { Link } from "react-router";

import type { OnboardingState } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { OnboardingPdfMark } from "./onboarding-pdf-mark.tsx";

type Resume = NonNullable<OnboardingState["resume"]>;

function uploadedLabel(iso: string) {
  const uploaded = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(uploaded.getFullYear(), uploaded.getMonth(), uploaded.getDate());
  const days = Math.round((start.getTime() - day.getTime()) / 86_400_000);

  if (days <= 0) {
    return copy.onboarding.uploadedToday;
  }

  if (days === 1) {
    return copy.onboarding.uploadedYesterday;
  }

  return copy.onboarding.uploadedOn(
    uploaded.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  );
}

export function OnboardingResumeCard({
  error,
  onContinue,
  onUpload,
  resume,
  uploading,
}: {
  error: boolean;
  onContinue: () => Promise<void>;
  onUpload: (file: File) => void;
  resume: Resume | null;
  uploading: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  const choose = () => {
    input.current?.click();
  };

  return (
    <section
      aria-labelledby="ob-h"
      className="obd rounded-lg border border-border bg-card shadow-sh"
    >
      <h2
        className="serif"
        id="ob-h"
        style={{ fontSize: "clamp(28px, 4vw, 36px)", lineHeight: 1.1 }}
      >
        {copy.onboarding.resumeTitlePlain}{" "}
        <span className="italic">{copy.onboarding.resumeTitleItalic}</span>
      </h2>
      <p className="mt-2.5 text-[14.5px] text-muted-foreground">{copy.onboarding.resumeIntro}</p>

      <div className="mt-6">
        <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
          <span className="lbl" style={{ margin: 0 }}>
            {copy.onboarding.resumeLabel}
          </span>
          <span className="req" style={{ marginLeft: 0 }}>
            {copy.onboarding.resumeRequired}
          </span>
        </div>
        <input
          accept="application/pdf"
          aria-label={copy.onboarding.resumeLabel}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file !== undefined) {
              onUpload(file);
            }

            event.target.value = "";
          }}
          ref={input}
          type="file"
        />
        {resume === null ? (
          <div className="dz">
            <p className="text-[14.5px] font-semibold">{copy.onboarding.resumeLabel}</p>
            <button
              className="btn2 mt-1"
              disabled={uploading}
              onClick={choose}
              style={{ minHeight: 44 }}
              type="button"
            >
              {copy.onboarding.resumeChoose}
            </button>
            <p className="hint">{copy.onboarding.resumeDropHint}</p>
          </div>
        ) : (
          <div
            className="flex items-center gap-[18px] border border-input bg-background p-4"
            style={{ borderRadius: 10 }}
          >
            <OnboardingPdfMark />
            <div className="min-w-0 flex-1">
              <p className="mono text-[14px] [overflow-wrap:anywhere]">{resume.filename}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {copy.onboarding.resumeMeta(resume.pages, copy.onboarding.resumeSize(resume.bytes))}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {uploadedLabel(resume.uploadedAt)}
              </p>
              <button
                className="btng -ml-3.5 mt-1"
                disabled={uploading}
                onClick={choose}
                style={{ minHeight: 44 }}
                type="button"
              >
                {copy.onboarding.resumeReplace}
              </button>
            </div>
          </div>
        )}
        {resume === null ? null : (
          <div className="okbox mt-3.5">
            <span className="mt-px flex-none">
              <NavGlyph name="check" size={16} />
            </span>
            <p className="text-[13.5px] text-foreground">{copy.onboarding.resumeKept}</p>
          </div>
        )}
        {resume?.unreadable === true ? (
          <output className="mt-3.5 block rounded-lg border border-[color:var(--need)] bg-need-soft px-4 py-3.5 text-[13.5px] text-need">
            {copy.onboarding.resumeUnreadable}
          </output>
        ) : null}
        <p className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
          <span className="mt-0.5 flex-none">
            <NavGlyph name="review" size={15} />
          </span>
          {copy.onboarding.resumeReads}
        </p>
        {error ? (
          <p className="hint mt-3 text-[color:var(--need)]" role="alert">
            {copy.onboarding.resumeUploadFailed}
          </p>
        ) : null}
      </div>

      <div className="ftr mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Link className="btng" style={{ minHeight: 44 }} to="/onboarding">
          <NavGlyph name="back" size={16} />
          {copy.onboarding.back}
        </Link>
        <button
          className="btn"
          disabled={resume === null || uploading}
          onClick={() => {
            void onContinue();
          }}
          style={{ minHeight: 48, padding: "0 26px" }}
          type="button"
        >
          {copy.onboarding.continue} <NavGlyph name="forward" size={16} />
        </button>
      </div>
    </section>
  );
}
