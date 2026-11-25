import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileText, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import {
  fetchCurrentResume,
  fetchProfileFacts,
  resumeFileUrl,
  uploadResumeFile,
} from "../lib/profile-api.ts";
import { safePdfUrl } from "../lib/pdf-url.ts";
import { PdfPreview } from "./pdf-preview.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { SectionSkeleton } from "./section-skeleton.tsx";

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

  const [localPreview, setLocalPreview] = useState<{
    bytes: number;
    filename: string;
    url: string;
  } | null>(null);

  const resumeQuery = useQuery({
    queryFn: fetchCurrentResume,
    queryKey: ["profile-resume"],
  });

  const factsQuery = useQuery({
    queryFn: fetchProfileFacts,
    queryKey: ["profile-facts"],
  });

  useEffect(
    () => () => {
      if (localPreview !== null) {
        URL.revokeObjectURL(localPreview.url);
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

  const factsCount =
    factsQuery.data?.facts.filter((fact) => fact.key !== "cover_letter_template").length ?? 0;

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

    const previewUrl = URL.createObjectURL(file);

    setLocalPreview({
      bytes: file.size,
      filename: file.name,
      url: previewUrl,
    });

    upload.mutate(file, {
      onError: () => {
        setLocalPreview(null);
        toast.error(copy.onboarding.resumeUploadFailed);
      },
    });
  };

  let statusBadge = null;

  if (current?.unreadable === true) {
    statusBadge = <Badge variant="need">{copy.nav.profilePages.resumeNeedsReupload}</Badge>;
  } else if (filename !== null) {
    statusBadge = <Badge variant="ok">{copy.nav.profilePages.resumeVerified}</Badge>;
  }

  let uploadButtonLabel: string = copyResume.replace;

  if (upload.isPending) {
    uploadButtonLabel = copy.nav.profilePages.resumeUploading;
  } else if (filename === null) {
    uploadButtonLabel = copy.nav.profilePages.resumeUploadPdf;
  }

  if (resumeQuery.isPending && current === null) {
    return <SectionSkeleton />;
  }

  return (
    <Card ariaLabelledBy="profile-resume-heading" className="p-5 md:p-6" id="profile-resume">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={dsCardTitle} id="profile-resume-heading">
            {copy.profile.tabs.resume}
          </h2>
          <p className={`${dsBody} mt-1`}>{copyResume.sub}</p>
        </div>
        {statusBadge}
      </div>

      <div className="mt-5 flex flex-col gap-5">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
          >
            <FileText size={20} />
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

        <PdfPreview filename={filename} pages={pages} pdfUrl={pdfUrl} />

        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-ok" size={16} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copyResume.strongNote}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {copyResume.note}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 border-y border-border py-3.5">
          <div>
            <dt className={dsEyebrow}>{copyResume.factsRead}</dt>
            <dd className="mt-1 font-serif text-card-title tabular-nums text-foreground">
              {`${String(factsCount)} saved`}
            </dd>
          </div>
          <div>
            <dt className={dsEyebrow}>{copy.nav.profilePages.resumeFormatLabel}</dt>
            <dd className="mt-1 font-serif text-card-title text-foreground">
              {copy.nav.profilePages.resumeFormatValue}
            </dd>
          </div>
        </dl>

        <input
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={upload.isPending}
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

        <p className="text-xs leading-relaxed text-muted-foreground">{copyResume.newFileNote}</p>
      </div>
    </Card>
  );
}
