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

  type Collect = (prefix: string, continuationToken?: string) => Promise<string[]>;

  const collect: Collect = async (prefix, continuationToken) => {
    const page = await client.list(
      continuationToken === undefined ? { prefix } : { continuationToken, prefix },
    );

    const keys = (page.contents ?? []).map((entry) => entry.key);

    if (page.isTruncated !== true) {
      return keys;
    }

    return [...keys, ...(await collect(prefix, page.nextContinuationToken))];
  };

  return {
    put: async (key: string, data: Uint8Array<ArrayBuffer>) => {
      await client.write(key, data);
    },
    putStream: async (key: string, data: AsyncIterable<Uint8Array>) => {
      const writer = client.file(key).writer();

      let bytes = 0;

      try {
        for await (const chunk of data) {
          bytes += chunk.length;

          await writer.write(chunk);
          await writer.flush();
        }

        await writer.end();
      } catch (error) {
        await writer.end(error instanceof Error ? error : new Error(String(error)));

        throw error;
      }

      return bytes;
    },
    get: async (key: string) => {
      const file = client.file(key);

      if (!(await file.exists())) {
        return null;
      }

      return new Uint8Array(await file.arrayBuffer());
    },
    getStream: async (key: string) => {
      const file = client.file(key);

      if (!(await file.exists())) {
        return null;
      }

      return file.stream();
    },
    delete: async (key: string) => {
      await client.delete(key);
    },
    async *list(prefix: string) {
      for (const key of await collect(prefix)) {
        yield key;
      }
    },
  } satisfies ObjectStore;
}
