import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { env } from "../src/server/config/env.ts";
import { createR2ObjectStore } from "../src/server/platform/ports/r2-object-store.ts";

const dryRun = process.argv.slice(2).includes("--dry-run");

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

interface KeyWalker {
  walk: (root: string, prefix?: string) => Promise<string[]>;
}

const walker: KeyWalker = {
  walk: async (root, prefix = "") => {
    const entries = await readdir(join(root, prefix), { withFileTypes: true });

    const nested = await Promise.all(
      entries.map(async (entry) => {
        const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

        if (entry.isDirectory()) {
          return walker.walk(root, key);
        }

        return entry.isFile() ? [key] : [];
      }),
    );

    return nested.flat();
  },
};

function filesEndpoint() {
  if (env.R2_BUCKET_FILES === undefined) {
    throw new Error(
      "Set R2_BUCKET_FILES, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
    );
  }

  if (
    env.R2_ACCOUNT_ID === undefined ||
    env.R2_ACCESS_KEY_ID === undefined ||
    env.R2_SECRET_ACCESS_KEY === undefined
  ) {
    throw new Error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.");
  }

  return {
    endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET_FILES,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

const root = resolve(env.OBJECT_STORE_ROOT);
const objects = createR2ObjectStore(filesEndpoint());
const keys = await walker.walk(root);

process.stdout.write(`move-objects-to-r2: ${String(keys.length)} objects under ${root}\n`);

let copied = 0;
let current = 0;

async function move(key: string) {
  const local = new Uint8Array(await readFile(join(root, key)));
  const digest = sha256(local);
  const remote = await objects.get(key);

  if (remote !== null && sha256(remote) === digest) {
    current += 1;
    process.stdout.write(`  current ${key}\n`);

    return;
  }

  if (dryRun) {
    copied += 1;
    process.stdout.write(`  would copy ${key} sha256 ${digest}\n`);

    return;
  }

  await objects.put(key, local);

  const readBack = await objects.get(key);

  if (readBack === null || sha256(readBack) !== digest) {
    throw new Error(`sha256 mismatch after copying ${key}`);
  }

  copied += 1;
  process.stdout.write(`  copied ${key} sha256 ${digest}\n`);
}

await Promise.all(keys.map(async (key) => move(key)));

if (dryRun) {
  process.stdout.write(`dry run: ${String(copied)} to copy, ${String(current)} already current\n`);
} else {
  process.stdout.write(`verified ${String(copied)} copied, ${String(current)} already current\n`);
}

process.stdout.write(
  `Local objects were not deleted. After checking R2, remove them with:\n  rm -rf ${root}\n`,
);
