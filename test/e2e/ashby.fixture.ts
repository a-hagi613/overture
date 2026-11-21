import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const FIXTURE_FORMS_DIR = join(process.cwd(), "test/e2e/fixtures/forms/ashby");
const RUNTIME_SOURCE = join(process.cwd(), "test/e2e/fixtures/forms/ashby-runtime.ts");

export interface AshbyFixturesState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  lastForm: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
}

export interface AshbyFixture {
  url: string;
  state: AshbyFixturesState;
  close: () => void;
}

const submitSchema = z.object({
  operationName: z.string(),
  variables: z.object({
    fields: z.record(z.string(), z.string()),
    flagged: z.boolean().optional(),
    reject: z.boolean().optional(),
  }),
});

const NO_FORM_PAGE =
  "<!doctype html><html><body><p>This position is no longer accepting applications.</p></body></html>";

export function startAshbyFixture() {
  const boardToken = "volta";
  const jobId = "123e02c6-445b-42bb-893c-addb1f6d4752";
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtime = transpiler.transformSync(readFileSync(RUNTIME_SOURCE, "utf8"));

  const state: AshbyFixturesState = {
    submissions: 0,
    applicationRequests: 0,
    formLoads: 0,
    lastForm: {},
    lastResumeBytes: null,
  };

  const pageFile = join(FIXTURE_FORMS_DIR, `${boardToken}-${jobId}.fixture.html`);

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/__fixture__/runtime.js") {
        return new Response(runtime, { headers: { "content-type": "text/javascript" } });
      }

      if (path === "/__fixture__/resume") {
        const form = await request.formData();
        const upload = form.get("resume");

        if (upload instanceof File) {
          state.lastResumeBytes = new Uint8Array(await upload.arrayBuffer());
        }

        return Response.json({ stored: upload instanceof File });
      }

      if (path === "/__fixture__/state") {
        return Response.json({
          applicationRequests: state.applicationRequests,
          formLoads: state.formLoads,
          submissions: state.submissions,
        });
      }

      if (path === "/api/non-user-graphql") {
        if (request.method !== "POST") {
          return new Response(null, { status: 405 });
        }

        state.applicationRequests += 1;

        const body = submitSchema.parse(await request.json());

        if (body.variables.reject === true) {
          return new Response("The application was refused.", { status: 422 });
        }

        state.submissions += 1;

        for (const [key, value] of Object.entries(body.variables.fields)) {
          state.lastForm[key] = value;
        }

        return Response.json({ data: { submitApplication: { success: true } } });
      }

      const match = /^\/(?<board>[a-z0-9-]+)\/(?<job>[0-9a-f-]+)\/application$/u.exec(path);

      if (match?.groups === undefined) {
        return new Response(NO_FORM_PAGE, { status: 404 });
      }

      if (match.groups["job"] !== jobId) {
        return new Response(NO_FORM_PAGE, { status: 404 });
      }

      if (request.method !== "GET") {
        return new Response(null, { status: 405 });
      }

      state.formLoads += 1;

      return new Response(new Uint8Array(readFileSync(pageFile)), {
        headers: { "content-type": "text/html" },
      });
    },
  });

  return {
    url: server.url.toString().replace(/\/$/u, ""),
    state,
    close: () => {
      void server.stop(true);
    },
  } satisfies AshbyFixture;
}
