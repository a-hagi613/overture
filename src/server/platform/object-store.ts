import { env } from "../config/env.ts";

import { createDiskObjectStore } from "./ports/object-store.ts";
import { createR2ObjectStore } from "./ports/r2-object-store.ts";

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
