import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

export { DrySubmitStoppedError } from "../../src/server/dispatch/dry-submit.ts";

export { fillErrorCode, fillFailureNote } from "../../src/server/dispatch/fill-failure.ts";

export { readLeverQuestions, runLeverAttempt } from "../../src/server/dispatch/ats/lever.ts";

export { readJazzhrQuestions, runJazzhrAttempt } from "../../src/server/dispatch/ats/jazzhr.ts";

export const CONFIRMATION_HTML = `<!doctype html>
<html lang="en"><body><h1>Thank you for applying</h1><p>Your application has been received.</p></body></html>`;

const valuesSchema = z.record(z.string(), z.string());

const RUNTIME_SOURCE = join(process.cwd(), "test/e2e/fixtures/forms/fixture-runtime.ts");

export interface RecordedPage {
  url: string;
  state: {
    formLoads: number;
    posts: { fields: Record<string, string>; files: Record<string, string>; path: string }[];
    uploads: string[];
  };
  close: () => void;
}

/**
 * Serves one sanitised live-page HTML file plus the shared fixture runtime, so a
 * saved page behaves like the board it came from without any live network.
 *
 * @param fixturePath Path to the saved, sanitised page.
 * @param pagePath The path the recording was made at, e.g. `/jobgether/<id>/apply`.
 * @param options Optional HTML mutation, used to prove a newly required question blocks.
 * @returns The server URL and what it recorded.
 */
export function startRecordedPage(
  fixturePath: string,
  pagePath: string,
  options: { mutate?: (html: string) => string } = {},
) {
  const recorded = readFileSync(fixturePath, "utf8");
  const html = options.mutate?.(recorded) ?? recorded;
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtime = transpiler.transformSync(readFileSync(RUNTIME_SOURCE, "utf8"));
  const posts: RecordedPage["state"]["posts"] = [];
  const uploads: string[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/__fixture__/runtime.js") {
        return new Response(runtime, { headers: { "content-type": "text/javascript" } });
      }

      if (url.pathname === "/__fixture__/resume") {
        const form = await request.formData();
        const upload = form.get("resume");

        if (upload instanceof File) {
          uploads.push(upload.name);
        }

        return Response.json({ stored: upload instanceof File });
      }

      if (url.pathname === "/__fixture__/values" && request.method === "POST") {
        valuesSchema.parse(await request.json());

        return Response.json({ recorded: true });
      }

      if (url.pathname === "/__fixture__/confirmation-shown" && request.method === "POST") {
        return Response.json({ recorded: true });
      }

      if (url.pathname === "/__fixture__/uploaded" && request.method === "POST") {
        const body = z.object({ name: z.string() }).parse(await request.json());

        uploads.push(body.name);

        return Response.json({ recorded: true });
      }

      if (url.pathname.endsWith("/thanks") || url.pathname.endsWith("/confirmation")) {
        return new Response(CONFIRMATION_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (request.method !== "POST") {
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      const type = request.headers.get("content-type") ?? "";
      const fields: Record<string, string> = {};
      const files: Record<string, string> = {};

      if (type.includes("multipart/form-data") || type.includes("x-www-form-urlencoded")) {
        for (const [name, value] of await request.formData()) {
          if (value instanceof File) {
            files[name] = value.name;
          } else {
            fields[name] = value;
          }
        }
      } else if (type.includes("application/json")) {
        const body = z
          .record(z.string(), z.string())
          .safeParse(await request.json().catch(() => null));

        if (body.success) {
          Object.assign(fields, body.data);
        }
      }

      posts.push({ fields, files, path: url.pathname });

      return new Response(CONFIRMATION_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  return {
    close: () => {
      void server.stop(true);
    },
    state: { formLoads: 0, posts, uploads },
    url: `${server.url.toString().replace(/\/$/u, "")}${pagePath}`,
  } satisfies RecordedPage;
}
