import { FileText } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { safePdfUrl } from "../lib/pdf-url.ts";

export function PdfPreview({
  compact = false,
  filename,
  pages,
  pdfUrl,
}: {
  compact?: boolean | undefined;
  filename: string | null;
  pages: number | null;
  pdfUrl: string | null;
}) {
  const pw = copy.profileWorkspace;
  const safeUrl = safePdfUrl(pdfUrl);

  const pageLabel =
    pages === null || pages <= 0 ? pw.pdfPreviewLabel : `Page 1 of ${String(pages)}`;

  const frameClass = compact
    ? "min-h-64 w-full flex-1 overflow-hidden rounded-md border border-border bg-card xl:min-h-0"
    : "aspect-3/4 w-full overflow-hidden rounded-md border border-border bg-card";

  const emptyClass = compact
    ? "flex min-h-64 w-full flex-1 flex-col items-center justify-center gap-3 rounded-md border border-border bg-card px-6 text-center xl:min-h-0"
    : "flex aspect-3/4 w-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-card px-6 text-center";

  return (
    <div
      className={
        compact
          ? "flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-muted/50 p-3"
          : "rounded-lg border border-border bg-muted/50 p-3"
      }
    >
      {safeUrl === null ? (
        <div className={emptyClass}>
          <FileText aria-hidden="true" className="text-muted-foreground" size={28} />
          <p className="font-mono text-xs font-medium text-foreground">
            {filename ?? pw.pdfPreviewEmpty}
          </p>
          <p className="text-xs text-muted-foreground">
            {copy.nav.profilePages.resumePreviewEmptyHint}
          </p>
        </div>
      ) : (
        <div className={frameClass}>
          <object
            aria-label={filename ?? pw.pdfPreviewTitle}
            className="h-full w-full"
            data={`${safeUrl}#toolbar=0&navpanes=0&scrollbar=0`}
            type="application/pdf"
          >
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText aria-hidden="true" className="text-muted-foreground" size={28} />
              <p className="font-mono text-xs font-medium text-foreground">
                {filename ?? pw.pdfPreviewFallbackTitle}
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
      <div className="mt-2.5 flex shrink-0 items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground tabular-nums">
        <span className="truncate font-mono">{filename ?? "—"}</span>
        <span className="shrink-0">{pageLabel}</span>
      </div>
    </div>
  );
}
