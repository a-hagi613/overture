export interface BucketObjectBody {
  text: () => Promise<string>;
}

/** The slice of the Workers `R2Bucket` binding the sentinel uses. */
export interface R2BucketBinding {
  get: (key: string) => Promise<BucketObjectBody | null>;
  put: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

/** The sentinel's view of R2, so tests can run it against a real directory. */
export interface SentinelBucket {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export function r2Bucket(binding: R2BucketBinding) {
  return {
    get: async (key: string) => {
      const object = await binding.get(key);

      return object === null ? null : await object.text();
    },
    put: async (key: string, value: string) => {
      await binding.put(key, value);
    },
    delete: async (key: string) => {
      await binding.delete(key);
    },
  } satisfies SentinelBucket;
}
