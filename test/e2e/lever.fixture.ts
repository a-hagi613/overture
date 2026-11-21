import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { readLeverFormHtml } from "../../src/server/pipeline/form-read.ts";

const FIXTURE_FORMS_DIR = join(process.cwd(), "test/e2e/fixtures/forms/lever");
const RUNTIME_SOURCE = join(process.cwd(), "test/e2e/fixtures/forms/fixture-runtime.ts");

export interface LeverFixturesState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  confirmationLoads: number;
  postingOpen: boolean;
  lastForm: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
}

export interface LeverFixture {
  url: string;
  state: LeverFixturesState;
  close: () => void;
}

interface LeverFixtureOptions {
  boardToken?: string;
  jobId?: string;
}

const valuesSchema = z.record(z.string(), z.string());

const NO_FORM_PAGE =
  "<!doctype html><html><body><p>This position is no longer accepting applications.</p></body></html>";

export async function recordedLeverFormQuestions(boardToken: string, jobId: string) {
  const form = await readLeverFormHtml(
    readFileSync(join(FIXTURE_FORMS_DIR, `${boardToken}-${jobId}.fixture.html`), "utf8"),
  );

  return form.questions;
}

export function startLeverFixture(options: LeverFixtureOptions = {}) {
  const boardToken = options.boardToken ?? "pyka";
  const jobId = options.jobId ?? "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb";
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtime = transpiler.transformSync(readFileSync(RUNTIME_SOURCE, "utf8"));

  const state: LeverFixturesState = {
    submissions: 0,
    applicationRequests: 0,
    formLoads: 0,
    confirmationLoads: 0,
    postingOpen: true,
    lastForm: {},
    lastResumeBytes: null,
  };

  const pageFile = (suffix: string) =>
    join(FIXTURE_FORMS_DIR, `${boardToken}-${jobId}${suffix}.fixture.html`);

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

      if (path === "/__fixture__/confirmation-shown" && request.method === "POST") {
        state.confirmationLoads += 1;

        return Response.json({ recorded: true });
      }

      if (path === "/__fixture__/values" && request.method === "POST") {
        const values = valuesSchema.parse(await request.json());

        for (const [key, value] of Object.entries(values)) {
          state.lastForm[key] = value;
        }

        return Response.json({ recorded: true });
      }

      if (path === "/__fixture__/state") {
        return Response.json({
          applicationRequests: state.applicationRequests,
          confirmationLoads: state.confirmationLoads,
          formLoads: state.formLoads,
          submissions: state.submissions,
        });
      }

      const match = /^\/(?<board>[a-z0-9-]+)\/(?<job>[0-9a-f-]+)\/(?<step>apply|thanks)$/u.exec(
        path,
      );

      if (match?.groups === undefined) {
        return new Response(NO_FORM_PAGE, { status: 404 });
      }

      const { job, step } = match.groups;

      if (step === "thanks") {
        if (request.method === "POST") {
          return new Response(null, { status: 405 });
        }

        return new Response(new Uint8Array(readFileSync(pageFile("-thanks"))), {
          headers: { "content-type": "text/html" },
        });
      }

      if (job !== jobId) {
        return new Response(NO_FORM_PAGE, { status: 404 });
      }

      if (request.method !== "POST") {
        state.formLoads += 1;

        if (!state.postingOpen) {
          return new Response(NO_FORM_PAGE, { status: 404 });
        }

        return new Response(new Uint8Array(readFileSync(pageFile(""))), {
          headers: { "content-type": "text/html" },
        });
      }

      state.submissions += 1;
      state.applicationRequests += 1;

      if (url.searchParams.get("refuse") === "1") {
        return new Response("The application was refused.", { status: 422 });
      }

      if (request.headers.get("content-type")?.startsWith("application/json") === true) {
        const body = z
          .object({ job_application: z.record(z.string(), z.string()) })
          .parse(await request.json());

        for (const [key, value] of Object.entries(body.job_application)) {
          state.lastForm[key] = value;
        }

        return Response.json({ ok: true }, { status: 201 });
      }

      const form = await request.formData();
      const upload = form.get("resume");

      if (upload instanceof File) {
        state.lastResumeBytes = new Uint8Array(await upload.arrayBuffer());
      }

      for (const key of form.keys()) {
        const value = form.get(key);

        if (value === null || value instanceof File) {
          continue;
        }

        state.lastForm[key] = value;
      }

      return Response.json({ ok: true }, { status: 201 });
    },
  });

  return {
    url: server.url.toString().replace(/\/$/u, ""),
    state,
    close: () => {
      void server.stop(true);
    },
  } satisfies LeverFixture;
}
