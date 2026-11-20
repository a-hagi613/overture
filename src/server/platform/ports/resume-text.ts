export interface ResumeTextPort {
  resumePdfFallback: (pdf: Uint8Array<ArrayBuffer>) => Promise<string>;
}

export const RESUME_PDF_MODEL = "claude-haiku-5-5";
