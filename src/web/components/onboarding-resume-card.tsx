import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Info, Upload } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

import type { OnboardingState } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

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
  backTo = "/onboarding",
  error,
  onContinue,
  onUpload,
  resume,
  uploading,
}: {
  backTo?: string;
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
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-8" variant="elevated">
      <h2 className={dsCardTitle} id="ob-h">
        {`${copy.onboarding.resumeTitlePlain} ${copy.onboarding.resumeTitleItalic}`}
      </h2>
      <p className={`${dsBody} mt-2`}>{copy.onboarding.resumeIntro}</p>

      <div className="mt-6">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className={dsEyebrow}>{copy.onboarding.resumeLabel}</span>
          <Badge variant="outline">{copy.onboarding.resumeRequired}</Badge>
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
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-input bg-background px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
              <Upload aria-hidden="true" size={20} />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {copy.onboarding.resumeLabel}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.onboarding.resumeDropHint}</p>
            <Button
              className="mt-4"
              disabled={uploading}
              onClick={choose}
              size="default"
              variant="secondary"
            >
              <Upload aria-hidden="true" size={15} />
              <span>{copy.onboarding.resumeChoose}</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
              <FileText aria-hidden="true" size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-semibold text-foreground">
                {resume.filename}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {`${copy.onboarding.resumeMeta(resume.pages, copy.onboarding.resumeSize(resume.bytes))} · ${uploadedLabel(resume.uploadedAt)}`}
              </p>
            </div>
            <Button
              className="shrink-0 self-start sm:self-auto"
              disabled={uploading}
              onClick={choose}
              size="sm"
              variant="outline"
            >
              {copy.onboarding.resumeReplace}
            </Button>
          </div>
        )}

        {resume === null ? null : (
          <Card className="mt-4 flex items-start gap-3 p-3.5 shadow-none" variant="muted">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-ok" size={16} />
            <p className="text-xs leading-relaxed text-foreground">{copy.onboarding.resumeKept}</p>
          </Card>
        )}

        {resume?.unreadable === true ? (
          <output className="mt-3 block rounded-lg border border-need/40 bg-need-soft px-4 py-3 text-xs font-medium text-need">
            {copy.onboarding.resumeUnreadable}
          </output>
        ) : null}

        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
          <span>{copy.onboarding.resumeReads}</span>
        </p>

        {error ? (
          <p className="mt-3 text-xs font-semibold text-need" role="alert">
            {copy.onboarding.resumeUploadFailed}
          </p>
        ) : null}
      </div>

      <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button asChild size="default" variant="ghost">
          <Link to={backTo}>
            <ArrowLeft aria-hidden="true" size={15} />
            <span>{copy.onboarding.back}</span>
          </Link>
        </Button>
        <Button
          disabled={resume === null || uploading}
          onClick={() => {
            void onContinue();
          }}
          size="lg"
          variant="primary"
        >
          <span>{copy.onboarding.continue}</span>
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </Card>
  );
}
