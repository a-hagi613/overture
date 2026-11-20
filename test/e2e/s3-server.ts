import { mkdirSync, mkdtempSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export interface S3Server {
  url: string;
  root: string;
  stop: () => Promise<void>;
}

interface StoredObject {
  key: string;
  bytes: number;
  modified: Date;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface ObjectWalker {
  walk: (directory: string, prefix?: string) => Promise<StoredObject[]>;
}

const walker: ObjectWalker = {
  walk: async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });

    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

        if (entry.isDirectory()) {
          return walker.walk(path, key);
        }

        if (entry.isFile()) {
          const info = await Bun.file(path).stat();

          return [{ key, bytes: info.size, modified: info.mtime }];
        }

        return [];
      }),
    );

    return nested.flat();
  },
};

function listXml(bucket: string, prefix: string, objects: StoredObject[]) {
  const matching = objects
    .filter((object) => object.key.startsWith(prefix))
    .toSorted((left, right) => left.key.localeCompare(right.key));

  const contents = matching
    .map(
      (object) =>
        `<Contents><Key>${escapeXml(object.key)}</Key><LastModified>${object.modified.toISOString()}</LastModified><ETag>&quot;${object.bytes.toString(16)}&quot;</ETag><Size>${String(object.bytes)}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${escapeXml(bucket)}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${String(matching.length)}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

function notFound() {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
    { status: 404, headers: { "content-type": "application/xml" } },
  );
}

export function startS3Server() {
  const root = mkdtempSync(join(tmpdir(), "overture-s3-"));

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const [bucket = "", ...rest] = url.pathname.replace(/^\/+/u, "").split("/");
      const key = rest.map((part) => decodeURIComponent(part)).join("/");
      const authorization = request.headers.get("authorization");

      if (authorization === null || !authorization.startsWith("AWS4-HMAC-SHA256 ")) {
        return new Response("signed requests only", { status: 403 });
      }

      const bucketRoot = resolve(root, bucket);

      if (!bucketRoot.startsWith(`${resolve(root)}${sep}`)) {
        return new Response("bad bucket", { status: 400 });
      }

      if (key === "" && request.method === "GET") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const objects = await walker.walk(bucketRoot);

        return new Response(listXml(bucket, prefix, objects), {
          headers: { "content-type": "application/xml" },
        });
      }

      const objectPath = resolve(bucketRoot, key);

      if (!objectPath.startsWith(`${bucketRoot}${sep}`)) {
        return new Response("bad key", { status: 400 });
      }

      if (request.method === "PUT") {
        const body = new Uint8Array(await request.arrayBuffer());

        await mkdir(dirname(objectPath), { recursive: true });
        await writeFile(objectPath, body);

        return new Response(null, {
          status: 200,
          headers: { etag: `"${String(body.byteLength)}"` },
        });
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const file = Bun.file(objectPath);

        if (!(await file.exists())) {
          return notFound();
        }

        const headers = new Headers({
          "content-type": file.type,
          etag: `"${String(file.size)}"`,
          "last-modified": new Date(file.lastModified).toUTCString(),
        });

        return request.method === "HEAD"
          ? new Response(null, { headers })
          : new Response(file, { headers });
      }

      if (request.method === "DELETE") {
        await rm(objectPath, { force: true });

        return new Response(null, { status: 204 });
      }

      return new Response("unsupported", { status: 405 });
    },
  });

  mkdirSync(root, { recursive: true });

  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    root,
    stop: async () => {
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    },
  } satisfies S3Server;
}

export function storedObjectPath(server: S3Server, bucket: string, key: string) {
  return join(server.root, bucket, key);
}
