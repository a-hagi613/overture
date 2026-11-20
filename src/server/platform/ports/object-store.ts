import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ObjectStore {
  put: (key: string, data: Uint8Array<ArrayBuffer>) => Promise<void>;
  get: (key: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  delete: (key: string) => Promise<void>;
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
  } satisfies ObjectStore;
}
