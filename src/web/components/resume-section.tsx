import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { fetchCurrentResume, resumeFileUrl, uploadResumeFile } from "../lib/profile-api.ts";
import { safePdfUrl } from "../lib/pdf-url.ts";
import { OnboardingResumeScan } from "./onboarding-resume-scan.tsx";
import { PdfPreview } from "./pdf-preview.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { SectionSkeleton } from "./section-skeleton.tsx";

const SCAN_MIN_MS = 2200;

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  return `${String(Math.round(bytes / 1024))} KB`;
}

function formatUploadedDate(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function ResumeSection() {
  const { resume: copyResume } = copy.profile;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const [localPreview, setLocalPreview] = useState<{
    bytes: number;
    filename: string;
    url: string;
  } | null>(null);

  const [scanningFile, setScanningFile] = useState<string | null>(null);

  const resumeQuery = useQuery({
    queryFn: fetchCurrentResume,
    queryKey: ["profile-resume"],
  });

  useEffect(
    () => () => {
      if (localPreview !== null) {
        URL.revokeObjectURL(localPreview.url);
      }

      if (scanTimerRef.current !== null) {
        globalThis.clearTimeout(scanTimerRef.current);
      }
    },
    [localPreview],
  );

  const pw = copy.profileWorkspace;

  const upload = useMutation({
    mutationFn: uploadResumeFile,
    onSuccess: (saved) => {
      setLocalPreview(null);
      queryClient.setQueryData(["profile-resume"], saved);
      void queryClient.invalidateQueries({ queryKey: ["profile-facts"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["ready"] });
      void queryClient.invalidateQueries({ queryKey: ["nav"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-strengthen"] });
      toast.success(pw.resumeUploadedToast);
    },
  });

  const current = resumeQuery.data ?? null;
  const filename = localPreview?.filename ?? current?.filename ?? null;
  const bytes = localPreview?.bytes ?? current?.bytes ?? null;
  const pages = current?.pages ?? null;
  const uploadedText = current === null ? "" : formatUploadedDate(current.uploadedAt);

  const pdfUrl = safePdfUrl(
    localPreview?.url ?? (current === null ? null : resumeFileUrl(current.id)),
  );

  const metaParts = [
    bytes === null ? null : formatBytes(bytes),
    pages === null ? null : `${String(pages)} ${pages === 1 ? "page" : "pages"}`,
    uploadedText === "" ? null : `Uploaded ${uploadedText}`,
  ].filter((part): part is string => part !== null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    event.target.value = "";

    if (file === null) {
      return;
    }

    if (file.type !== "application/pdf") {
      toast.error(pw.resumePdfOnlyError);

      return;
    }

    if (scanTimerRef.current !== null) {
      globalThis.clearTimeout(scanTimerRef.current);
    }

    const previewUrl = URL.createObjectURL(file);

    setLocalPreview({
      bytes: file.size,
      filename: file.name,
      url: previewUrl,
    });
    setScanningFile(file.name);

    scanTimerRef.current = globalThis.setTimeout(() => {
      setScanningFile(null);
      scanTimerRef.current = null;
    }, SCAN_MIN_MS);

    upload.mutate(file, {
      onError: () => {
        if (scanTimerRef.current !== null) {
          globalThis.clearTimeout(scanTimerRef.current);
          scanTimerRef.current = null;
        }

        setScanningFile(null);
        setLocalPreview(null);
        toast.error(copy.onboarding.resumeUploadFailed);
      },
    });
  };

  const showScanner = upload.isPending || scanningFile !== null;
  const activeScanName = scanningFile ?? filename ?? copy.onboarding.resumeLabel;

  let statusBadge = null;

  if (current?.unreadable === true) {
    statusBadge = <Badge variant="need">{copy.nav.profilePages.resumeNeedsReupload}</Badge>;
  } else if (filename !== null) {
    statusBadge = <Badge variant="ok">{copy.nav.profilePages.resumeVerified}</Badge>;
  }

  let uploadButtonLabel: string = copyResume.replace;

  if (showScanner) {
    uploadButtonLabel = copy.nav.profilePages.resumeUploading;
  } else if (filename === null) {
    uploadButtonLabel = copy.nav.profilePages.resumeUploadPdf;
  }

  if (resumeQuery.isPending && current === null) {
    return <SectionSkeleton />;
  }

  return (
    <Card
      ariaLabelledBy="profile-resume-heading"
      className="flex h-full min-h-0 flex-col p-5"
      id="profile-resume"
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={dsCardTitle} id="profile-resume-heading">
            {copy.profile.tabs.resume}
          </h2>
          <p className={`${dsBody} mt-1`}>{copyResume.sub}</p>
        </div>
        {statusBadge}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex shrink-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
          >
            <FileText size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-semibold text-foreground">
              {filename ?? pw.resumeNoFileLabel}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {metaParts.length === 0 ? pw.resumeUploadHint : metaParts.join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {showScanner ? (
            <OnboardingResumeScan filename={activeScanName} />
          ) : (
            <PdfPreview compact filename={filename} pages={pages} pdfUrl={pdfUrl} />
          )}
        </div>

        <input
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Button
            disabled={showScanner}
            onClick={() => {
              fileInputRef.current?.click();
            }}
            size="default"
            variant="primary"
          >
            <Upload aria-hidden="true" size={15} />
            <span>{uploadButtonLabel}</span>
          </Button>

          {pdfUrl === null ? null : (
            <Button asChild size="default" variant="outline">
              <a download={filename ?? "resume.pdf"} href={pdfUrl}>
                <Download aria-hidden="true" size={15} />
                <span>{copyResume.download}</span>
              </a>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
