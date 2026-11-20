import type { ObjectStore } from "./object-store.ts";

export interface R2ObjectStoreConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2ObjectStore(config: R2ObjectStoreConfig) {
  const client = new Bun.S3Client({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
  });

  return {
    put: async (key: string, data: Uint8Array<ArrayBuffer>) => {
      await client.write(key, data);
    },
    get: async (key: string) => {
      const file = client.file(key);

      if (!(await file.exists())) {
        return null;
      }

      return new Uint8Array(await file.arrayBuffer());
    },
    delete: async (key: string) => {
      await client.delete(key);
    },
  } satisfies ObjectStore;
}
