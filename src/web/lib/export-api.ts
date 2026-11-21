import { z } from "zod";

import { byteStream, decryptExport } from "../../shared/export-crypto.ts";

const exportStateSchema = z.object({
  downloadUrl: z.string().nullable(),
  expiresAt: z.number().nullable(),
  id: z.string().nullable(),
  readyAt: z.number().nullable(),
  requestedAt: z.number().nullable(),
  status: z.enum(["none", "preparing", "ready", "expired", "failed"]),
});

const exportRequestSchema = exportStateSchema.extend({ replaced: z.boolean() });

export type AccountExportState = z.infer<typeof exportStateSchema>;

export type AccountExportRequest = z.infer<typeof exportRequestSchema>;

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`export request failed: ${String(response.status)}`);
  }

  const body: unknown = await response.json();

  return body;
}

export async function fetchExportState() {
  return exportStateSchema.parse(await jsonFrom(await fetch("/api/account/export")));
}

export async function requestExport() {
  return exportRequestSchema.parse(
    await jsonFrom(
      await fetch("/api/account/export", {
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );
}

/**
 * Download the encrypted archive and decrypt it with the key in its link, then
 * save the zip. The key never leaves the browser.
 * @param downloadUrl The state's download URL, with the key in its fragment.
 */
export async function downloadExport(downloadUrl: string) {
  const hashAt = downloadUrl.indexOf("#");
  const path = hashAt === -1 ? downloadUrl : downloadUrl.slice(0, hashAt);
  const key = hashAt === -1 ? "" : decodeURIComponent(downloadUrl.slice(hashAt + 1));

  if (key === "") {
    throw new Error("The download link has no key.");
  }

  const response = await fetch(path);

  if (!response.ok || response.body === null) {
    throw new Error(`export download failed: ${String(response.status)}`);
  }

  const parts: BlobPart[] = [];

  for await (const chunk of decryptExport(key, byteStream(response.body))) {
    parts.push(new Uint8Array(chunk));
  }

  const url = URL.createObjectURL(new Blob(parts, { type: "application/zip" }));
  const anchor = document.createElement("a");

  anchor.download = "overture-export.zip";
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}
