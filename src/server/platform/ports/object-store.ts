import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ObjectStore {
  put: (key: string, data: Uint8Array<ArrayBuffer>) => Promise<void>;
  putStream: (key: string, data: AsyncIterable<Uint8Array>) => Promise<number>;
  get: (key: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  getStream: (key: string) => Promise<ReadableStream<Uint8Array> | null>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => AsyncIterable<string>;
}

async function keysUnder(root: string) {
  const keys: string[] = [];

  for await (const key of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true })) {
    keys.push(key.replaceAll("\\", "/"));
  }

  return keys;
}

export function createDiskObjectStore(root: string) {
  const pathFor = (key: string) => {
    if (key.includes("..") || key.includes("\\") || key.startsWith("/")) {
      throw new Error(`illegal object key: ${key}`);
    }

    const absolute = resolve(root, key);

    if (!absolute.startsWith(resolve(root))) {
      throw new Error(`illegal object key: ${key}`);
    }

    return absolute;
  };

  return {
    put: async (key: string, data: Uint8Array<ArrayBuffer>) => {
      const path = pathFor(key);

      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    putStream: async (key: string, data: AsyncIterable<Uint8Array>) => {
      const path = pathFor(key);

      await mkdir(dirname(path), { recursive: true });

      const writer = Bun.file(path).writer();

      let bytes = 0;

      try {
        for await (const chunk of data) {
          bytes += chunk.length;

          await writer.write(chunk);
        }

        await writer.end();
      } catch (error) {
        await writer.end(error instanceof Error ? error : new Error(String(error)));

        throw error;
      }

      return bytes;
    },
    getStream: async (key: string) => {
      const file = Bun.file(pathFor(key));

      if (!(await file.exists())) {
        return null;
      }

      return file.stream();
    },
    get: async (key: string) => {
      try {
        const file = await readFile(pathFor(key));
        const bytes = new Uint8Array(file.byteLength);

        bytes.set(file);

        return bytes;
      } catch {
        return null;
      }
    },
    delete: async (key: string) => {
      await rm(pathFor(key), { force: true });
    },
    async *list(prefix: string) {
      const found = await keysUnder(resolve(root));

      for (const key of found) {
        if (key.startsWith(prefix)) {
          yield key;
        }
      }
    },
  } satisfies ObjectStore;
}
