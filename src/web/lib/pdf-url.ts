const API_RESUME_FILE_PATTERN = /^(?<path>\/api\/profile\/resume\/[A-Za-z0-9._~%-]+\/file)$/u;
const BLOB_PDF_PATTERN = /^blob:(?<url>https?:\/\/[A-Za-z0-9.:[\]_-]+\/[A-Za-z0-9-]+)$/u;

export function safePdfUrl(raw: string | null) {
  if (raw === null) {
    return null;
  }

  const apiMatch = API_RESUME_FILE_PATTERN.exec(raw);

  if (apiMatch?.groups?.path !== undefined) {
    return apiMatch.groups.path;
  }

  const blobMatch = BLOB_PDF_PATTERN.exec(raw);

  if (blobMatch?.groups?.url !== undefined) {
    return `blob:${blobMatch.groups.url}`;
  }

  return null;
}
