import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createR2ObjectStore } from "../src/server/platform/ports/r2-object-store.ts";

const args = process.argv.slice(2);

function argument(name: string) {
  const index = args.indexOf(`--${name}`);

  return index === -1 ? undefined : args[index + 1];
}

const accountId = Bun.env.R2_ACCOUNT_ID;
const accessKeyId = Bun.env.R2_ACCESS_KEY_ID;
const secretAccessKey = Bun.env.R2_SECRET_ACCESS_KEY;
const bucket = Bun.env.R2_BUCKET_FILES;

if (
  accountId === undefined ||
  accessKeyId === undefined ||
  secretAccessKey === undefined ||
  bucket === undefined
) {
  throw new Error(
    "pull-forms reads R2 only: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_FILES",
  );
}

const ats = argument("ats");
const outputRoot = argument("out") ?? "test/e2e/fixtures/forms";
const prefix = ats === undefined ? "fixtures/" : `fixtures/${ats}/`;

const objects = createR2ObjectStore({
  accessKeyId,
  bucket,
  endpoint: Bun.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
  secretAccessKey,
});

let written = 0;

for await (const key of objects.list(prefix)) {
  const bytes = await objects.get(key);

  if (bytes === null) {
    continue;
  }

  const path = join(outputRoot, key.replace(/^fixtures\//u, ""));

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  written += 1;
}

process.stdout.write(
  `pulled ${String(written)} fixture file(s) from ${prefix} into ${outputRoot}\n`,
);
