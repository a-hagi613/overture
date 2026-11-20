import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_FORMS_DIR = join(process.cwd(), "test/e2e/fixtures/forms/greenhouse");
const RUNTIME_SOURCE = join(process.cwd(), "test/e2e/fixtures/forms/fixture-runtime.ts");

export interface GreenhouseFixturesState {
  submissions: number;
  code: string;
  codeAsked: boolean;
  lastForm: Record<string, string>;
  lastChoices: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
}

export interface GreenhouseFixture {
  url: string;
  state: GreenhouseFixturesState;
  close: () => void;
}

export const NO_FORM_PAGE =
  "<!doctype html><html><body><p>This position is no longer accepting applications.</p></body></html>";

const CODE_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7"];

export function startGreenhouseFixture() {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtime = transpiler.transformSync(readFileSync(RUNTIME_SOURCE, "utf8"));

  const state: GreenhouseFixturesState = {
    submissions: 0,
    code: "48211357",
    codeAsked: false,
    lastForm: {},
    lastChoices: {},
    lastResumeBytes: null,
  };

  const typedCode = () =>
    CODE_DIGITS.map((digit) => state.lastForm[`security-input-${digit}`] ?? "").join("");

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/__fixture__/runtime.js") {
        return new Response(runtime, { headers: { "content-type": "text/javascript" } });
      }

      if (path === "/__fixture__/mail") {
        return Response.json(state.code);
      }

      if (path === "/__fixture__/resume") {
        const form = await request.formData();
        const upload = form.get("resume");

        if (upload instanceof File) {
          state.lastResumeBytes = new Uint8Array(await upload.arrayBuffer());
        }

        return Response.json({ stored: upload instanceof File });
      }

      if (path === "/__fixture__/choice") {
        const fieldId = url.searchParams.get("fieldId");
        const value = url.searchParams.get("value");

        if (fieldId !== null && value !== null) {
          state.lastChoices[fieldId] = value;
        }

        return new Response(null, { status: 204 });
      }

      if (path === "/__fixture__/state") {
        return Response.json({ submissions: state.submissions, codeAsked: state.codeAsked });
      }

      const match =
        /\/(?<board>[a-z]+)\/jobs\/(?<job>[0-9]+)(?<confirmation>\/confirmation)?/u.exec(path);

      if (match?.groups === undefined) {
        return new Response(NO_FORM_PAGE, { status: 404 });
      }

      const { board, job, confirmation } = match.groups;

      if (confirmation !== undefined && request.method !== "POST") {
        let page = Buffer.from(NO_FORM_PAGE);

        try {
          page = readFileSync(join(FIXTURE_FORMS_DIR, `${board}-${job}-confirmation.fixture.html`));
        } catch {
          return new Response(new Uint8Array(page), {
            status: 404,
            headers: { "content-type": "text/html" },
          });
        }

        return new Response(new Uint8Array(page), { headers: { "content-type": "text/html" } });
      }

      const pagePath = join(FIXTURE_FORMS_DIR, `${board}-${job}.fixture.html`);

      if (request.method !== "POST") {
        let page = Buffer.from(NO_FORM_PAGE);

        try {
          page = readFileSync(pagePath);
        } catch {
          return new Response(new Uint8Array(page), {
            status: 404,
            headers: { "content-type": "text/html" },
          });
        }

        return new Response(new Uint8Array(page), { headers: { "content-type": "text/html" } });
      }

      state.submissions += 1;

      const wantsCode = url.searchParams.get("verify") === "1";

      if (wantsCode && !state.codeAsked) {
        state.codeAsked = true;

        return Response.json({ errors: ["captcha-failed"] }, { status: 428 });
      }

      const form = await request.formData();

      const upload = [form.get("resume"), form.get("cover_letter")].find(
        (value) => value instanceof File,
      );

      if (upload instanceof File) {
        state.lastResumeBytes = new Uint8Array(await upload.arrayBuffer());
      }

      const keys = [...form.keys()];

      for (const key of keys) {
        const value = form.get(key);

        if (value === null || value instanceof File) {
          continue;
        }

        state.lastForm[key] = value;
      }

      if (wantsCode && typedCode() !== state.code) {
        return new Response("That code was not accepted.", { status: 422 });
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
  } satisfies GreenhouseFixture;
}
