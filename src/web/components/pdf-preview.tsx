import { FileText } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { safePdfUrl } from "../lib/pdf-url.ts";

export function PdfPreview({
  filename,
  pages,
  pdfUrl,
}: {
  filename: string | null;
  pages: number | null;
  pdfUrl: string | null;
}) {
  const safeUrl = safePdfUrl(pdfUrl);
  const pageLabel = pages === null || pages <= 0 ? "PDF preview" : `Page 1 of ${String(pages)}`;

  return (
    <div className="rounded-xl border border-border bg-muted p-4">
      {safeUrl === null ? (
        <div className="flex aspect-[8.5/11] w-full flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 text-center shadow-sh">
          <FileText aria-hidden="true" className="text-muted-foreground" size={32} />
          <p className="font-mono text-xs font-medium text-foreground">
            {filename ?? "No resume uploaded yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {copy.nav.profilePages.resumePreviewEmptyHint}
          </p>
        </div>
      ) : (
        <div className="aspect-[8.5/11] w-full overflow-hidden rounded-lg border border-border bg-card shadow-sh">
          <object
            aria-label={filename ?? "Resume PDF preview"}
            className="h-full w-full"
            data={`${safeUrl}#toolbar=0&navpanes=0&scrollbar=0`}
            type="application/pdf"
          >
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText aria-hidden="true" className="text-muted-foreground" size={32} />
              <p className="font-mono text-xs font-medium text-foreground">
                {filename ?? "Resume PDF"}
              </p>
              <a
                className="text-xs font-medium text-signal-text underline underline-offset-4"
                href={safeUrl}
                rel="noreferrer"
                target="_blank"
              >
                {copy.nav.profilePages.resumeOpenPdf}
              </a>
            </div>
          </object>
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground tabular-nums">
        <span className="truncate font-mono">{filename ?? "—"}</span>
        <span className="shrink-0">{pageLabel}</span>
      </div>
    </div>
  );
}
