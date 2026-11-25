import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Info,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { OnboardingState } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { safePdfUrl } from "../lib/pdf-url.ts";
import { OnboardingResumeScan } from "./onboarding-resume-scan.tsx";
import { PdfPreview } from "./pdf-preview.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

type Resume = NonNullable<OnboardingState["resume"]>;

const SCAN_MIN_MS = 2200;

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
  backLabel = copy.onboarding.back,
  backTo,
  error,
  onContinue,
  onUpload,
  pdfUrl,
  resume,
  uploading,
}: {
  backLabel?: string | undefined;
  backTo?: string | undefined;
  error: boolean;
  onContinue: () => Promise<void>;
  onUpload: (file: File) => void;
  pdfUrl: string | null;
  resume: Resume | null;
  uploading: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [continueFailed, setContinueFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFilename, setScanFilename] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (scanTimer.current !== null) {
        globalThis.clearTimeout(scanTimer.current);
      }
    },
    [],
  );

  const choose = () => {
    input.current?.click();
  };

  const handleSelectedFile = (file: File) => {
    if (scanTimer.current !== null) {
      globalThis.clearTimeout(scanTimer.current);
    }

    setScanFilename(file.name);
    setScanning(true);
    onUpload(file);
    scanTimer.current = globalThis.setTimeout(() => {
      setScanning(false);
      scanTimer.current = null;
    }, SCAN_MIN_MS);
  };

  const continueOn = async () => {
    if (continuing || resume === null || uploading || scanning) {
      return;
    }

    setContinuing(true);
    setContinueFailed(false);

    try {
      await onContinue();
    } catch {
      setContinueFailed(true);
      setContinuing(false);
    }
  };

  const showScanner = uploading || scanning;
  const activeFilename = scanFilename ?? resume?.filename ?? copy.onboarding.resumeLabel;
  const verifiedUrl = safePdfUrl(pdfUrl);

  let headerBadge = <Badge variant="outline">{copy.onboarding.resumeRequired}</Badge>;

  if (resume?.unreadable === true) {
    headerBadge = <Badge variant="need">{copy.nav.profilePages.resumeNeedsReupload}</Badge>;
  } else if (resume !== null) {
    headerBadge = <Badge variant="ok">{copy.nav.profilePages.resumeVerified}</Badge>;
  }

  let bodySlot = (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition ${
        dragging ? "border-signal bg-signal-soft/40" : "border-input bg-muted/30"
      }`}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const [file] = event.dataTransfer.files;

        if (file !== undefined) {
          handleSelectedFile(file);
        }
      }}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground">
        <Upload aria-hidden="true" size={18} />
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground">
        {copy.onboarding.resumeDropTitle}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{copy.onboarding.resumeDropHint}</p>
      <Button
        className="mt-4"
        disabled={showScanner}
        onClick={choose}
        size="default"
        variant="secondary"
      >
        <Upload aria-hidden="true" size={15} />
        <span>{copy.onboarding.resumeChoose}</span>
      </Button>
    </div>
  );

  if (showScanner) {
    bodySlot = <OnboardingResumeScan filename={activeFilename} />;
  } else if (resume !== null) {
    bodySlot = (
      <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-12">
        <div className="space-y-4 sm:col-span-7">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground">
              <FileText aria-hidden="true" size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-semibold text-foreground">
                {resume.filename}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {`${copy.onboarding.resumeMeta(resume.pages, copy.onboarding.resumeSize(resume.bytes))} · ${uploadedLabel(resume.uploadedAt)}`}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-ok" size={16} />
            <p className="text-xs leading-relaxed text-foreground">{copy.onboarding.resumeKept}</p>
          </div>

          {resume.unreadable ? (
            <output className="block rounded-lg border border-need/40 bg-need-soft px-4 py-3 text-xs font-medium text-need">
              {copy.onboarding.resumeUnreadable}
            </output>
          ) : null}

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
            <span>{copy.onboarding.resumeReads}</span>
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Button disabled={showScanner} onClick={choose} size="sm" variant="outline">
              <Upload aria-hidden="true" size={14} />
              <span>{copy.onboarding.resumeReplace}</span>
            </Button>
            {verifiedUrl === null ? null : (
              <Button asChild size="sm" variant="ghost">
                <a download={resume.filename} href={verifiedUrl}>
                  <Download aria-hidden="true" size={14} />
                  <span>{copy.profile.resume.download}</span>
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="sm:col-span-5">
          <PdfPreview filename={resume.filename} pages={resume.pages} pdfUrl={verifiedUrl} />
        </div>
      </div>
    );
  }

  return (
    <Card ariaLabelledBy="ob-h" className="p-6 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={dsCardTitle} id="ob-h">
            {copy.onboarding.resumeTitlePlain}
          </h2>
          <p className={`${dsBody} mt-1`}>{copy.onboarding.resumeIntro}</p>
        </div>
        {headerBadge}
      </div>

      <div className="mt-6">
        <span className={`${dsEyebrow} mb-2.5 block`}>{copy.onboarding.resumeLabel}</span>

        <input
          accept="application/pdf"
          aria-label={copy.onboarding.resumeLabel}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file !== undefined) {
              handleSelectedFile(file);
            }

            event.target.value = "";
          }}
          ref={input}
          type="file"
        />

        {bodySlot}

        {error ? (
          <p className="mt-3 text-xs font-semibold text-need" role="alert">
            {copy.onboarding.resumeUploadFailed}
          </p>
        ) : null}
        {continueFailed ? (
          <p className="mt-3 text-xs font-semibold text-need" role="alert">
            {copy.onboarding.saveFailed}
          </p>
        ) : null}
      </div>

      <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
        {backTo === undefined ? (
          <span />
        ) : (
          <Button asChild size="default" variant="ghost">
            <Link to={backTo}>
              <ArrowLeft aria-hidden="true" size={15} />
              <span>{backLabel}</span>
            </Link>
          </Button>
        )}
        <Button
          ariaBusy={continuing}
          disabled={resume === null || showScanner || continuing}
          onClick={() => {
            void continueOn();
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
