import type { APIRequestContext } from "@playwright/test";

import { decryptExport } from "../../src/shared/export-crypto.ts";

/**
 * Download an export and decrypt it with the key in its link.
 * @param owner The signed-in request context.
 * @param downloadUrl The state's download link, including the fragment key.
 * @returns The decrypted archive bytes.
 */
export async function downloadArchive(owner: APIRequestContext, downloadUrl: string) {
  const path = downloadUrl.slice(0, downloadUrl.indexOf("#"));
  const key = downloadUrl.slice(downloadUrl.indexOf("#") + 1);
  const response = await owner.get(path);

  if (response.status() !== 200) {
    throw new Error(`The export download failed with ${String(response.status())}.`);
  }

  const cipher = new Uint8Array(await response.body());
  const parts: Uint8Array[] = [];

  for await (const chunk of decryptExport(
    key,
    (async function* source() {
      await Promise.resolve();

      yield cipher;
    })(),
  )) {
    parts.push(chunk);
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);

  let at = 0;

  for (const part of parts) {
    archive.set(part, at);
    at += part.length;
  }

  return archive;
}
