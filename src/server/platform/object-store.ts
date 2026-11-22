import { env } from "../config/env.ts";

import { createDiskObjectStore } from "./ports/object-store.ts";
import { createR2ObjectStore } from "./ports/r2-object-store.ts";

/**
 * The Litestream replica bucket, read only for storage attribution. Litestream
 * writes it; the app never does, and a missing bucket simply means backups are
 * not configured on this machine.
 * @returns the R2 store for the backups bucket, or null when it is unconfigured
 */
export function createConfiguredBackupStore() {
  if (
    env.R2_ACCOUNT_ID !== undefined &&
    env.R2_ACCESS_KEY_ID !== undefined &&
    env.R2_SECRET_ACCESS_KEY !== undefined &&
    env.R2_BUCKET_BACKUPS !== undefined
  ) {
    return createR2ObjectStore({
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: env.R2_BUCKET_BACKUPS,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
  }

  return null;
}

export function createConfiguredObjectStore() {
  if (
    env.R2_ACCOUNT_ID !== undefined &&
    env.R2_ACCESS_KEY_ID !== undefined &&
    env.R2_SECRET_ACCESS_KEY !== undefined &&
    env.R2_BUCKET_FILES !== undefined
  ) {
    return createR2ObjectStore({
      endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: env.R2_BUCKET_FILES,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
  }

  return createDiskObjectStore(env.OBJECT_STORE_ROOT);
}
