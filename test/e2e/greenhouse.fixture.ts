import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const FIXTURE_FORMS_DIR = join(process.cwd(), "test/e2e/fixtures/forms/greenhouse");
const RUNTIME_SOURCE = join(process.cwd(), "test/e2e/fixtures/forms/fixture-runtime.ts");

export interface GreenhouseFixturesState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  confirmationLoads: number;
  code: string;
  codeAsked: boolean;
  postingOpen: boolean;
  lastForm: Record<string, string>;
  lastChoices: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
  applicationPaths: string[];
  mutation: string | null;
  redirect: "none" | "board" | "company";
  codePrompt: boolean;
  refuse: boolean;
}

export interface GreenhouseFixture {
  url: string;
  state: GreenhouseFixturesState;
  close: () => void;
}

export interface GreenhouseFixtureOptions {
  code?: string;
}

export const NO_FORM_PAGE =
  "<!doctype html><html><body><p>This position is no longer accepting applications.</p></body></html>";

const CODE_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7"];

const REDIRECT_TO_BOARD = "/curaleaf/jobs/8925575002";
const OTHER_EMPLOYER_FORM = join(FIXTURE_FORMS_DIR, "curaleaf-8925575002.fixture.html");

const valuesSchema = z.record(z.string(), z.string());

const holdSchema = z.object({ form: z.boolean().optional(), confirmation: z.boolean().optional() });

const mutationSchema = z.object({ mutation: z.string().nullable() });

const withMutation = (html: string, mutation: string | null) =>
  mutation === null
    ? html
    : html.replace(
        "</body>",
        `<script>globalThis.fixtureMutation = ${JSON.stringify(mutation)};</script></body>`,
      );

export function startGreenhouseFixture(options: GreenhouseFixtureOptions = {}) {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtime = transpiler.transformSync(readFileSync(RUNTIME_SOURCE, "utf8"));

  const state: GreenhouseFixturesState = {
    submissions: 0,
    applicationRequests: 0,
    formLoads: 0,
    confirmationLoads: 0,
    code: options.code ?? "48211357",
    codeAsked: false,
    postingOpen: true,
    lastForm: {},
    lastChoices: {},
    lastResumeBytes: null,
    applicationPaths: [],
    mutation: null,
    redirect: "none",
    codePrompt: false,
    refuse: false,
  };

  let holdForm = false;
  let holdConfirmation = false;
  let waiters: (() => void)[] = [];

  const waitForRelease = async () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
    });

  const release = () => {
    holdForm = false;
    holdConfirmation = false;
    const pending = waiters;

    waiters = [];

    for (const resolve of pending) {
      resolve();
    }
  };

  const typedCode = () =>
    CODE_DIGITS.map((digit) => state.lastForm[`security-input-${digit}`] ?? "").join("");

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      const feedMatch = /^\/v1\/boards\/(?<token>[^/]+)\/jobs\/(?<jobId>[^/]+)$/u.exec(path);

      if (feedMatch !== null) {
        return state.postingOpen
          ? Response.json({ id: feedMatch.groups?.["jobId"] ?? "", title: "Fixture Posting" })
          : new Response(null, { status: 404 });
      }

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

      if (path === "/__fixture__/confirmation-shown" && request.method === "POST") {
        state.confirmationLoads += 1;

        if (holdConfirmation) {
          await waitForRelease();
        }

        return Response.json({ recorded: true });
      }

      if (path === "/__fixture__/values") {
        const values = valuesSchema.parse(await request.json());

        for (const [key, value] of Object.entries(values)) {
          state.lastForm[key] = value;
        }

        return Response.json({ recorded: true });
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
        return Response.json({
          submissions: state.submissions,
          applicationRequests: state.applicationRequests,
          formLoads: state.formLoads,
          confirmationLoads: state.confirmationLoads,
          codeAsked: state.codeAsked,
          holdForm,
          holdConfirmation,
          mutation: state.mutation,
        });
      }

      if (path === "/__fixture__/mutate") {
        const body = mutationSchema.parse(await request.json());

        state.mutation = body.mutation;

        return Response.json({ mutation: state.mutation });
      }

      if (path === "/__fixture__/hold") {
        const body = holdSchema.parse(await request.json());

        holdForm = body.form === true;
        holdConfirmation = body.confirmation === true;

        return Response.json({ holdForm, holdConfirmation });
      }

      if (path === "/__fixture__/release") {
        release();

        return Response.json({ released: true });
      }

      const routePath =
        path === "/embed/job_app"
          ? `/${url.searchParams.get("for") ?? ""}/jobs/${url.searchParams.get("token") ?? ""}`
          : path;

      const match =
        /\/(?<board>[a-z]+)\/jobs\/(?<job>[0-9]+)(?<confirmation>\/confirmation)?/u.exec(routePath);

      if (match?.groups === undefined) {
        return new Response(NO_FORM_PAGE, { status: 404 });
      }

      const { board, job, confirmation } = match.groups;

      if (path === "/embed/job_app" && request.method !== "POST" && state.redirect === "board") {
        return new Response(null, { status: 302, headers: { location: REDIRECT_TO_BOARD } });
      }

      if (path === "/embed/job_app" && request.method !== "POST" && state.redirect === "company") {
        return new Response(new Uint8Array(readFileSync(OTHER_EMPLOYER_FORM)), {
          headers: { "content-type": "text/html" },
        });
      }

      if (confirmation !== undefined && request.method !== "POST") {
        state.confirmationLoads += 1;

        if (holdConfirmation) {
          await waitForRelease();
        }

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
        state.formLoads += 1;

        if (holdForm) {
          await waitForRelease();
        }

        let page = NO_FORM_PAGE;

        try {
          page = readFileSync(pagePath, "utf8");
        } catch {
          return new Response(page, {
            status: 404,
            headers: { "content-type": "text/html" },
          });
        }

        return new Response(withMutation(page, state.mutation), {
          headers: { "content-type": "text/html" },
        });
      }

      state.submissions += 1;
      state.applicationRequests += 1;
      state.applicationPaths.push(path);

      if (state.refuse) {
        return new Response("The application was refused.", { status: 403 });
      }

      const wantsCode = state.codePrompt;

      if (wantsCode && !state.codeAsked) {
        state.codeAsked = true;

        return Response.json({ errors: ["captcha-failed"] }, { status: 428 });
      }

      if (request.headers.get("content-type")?.startsWith("multipart/form-data") === true) {
        const form = await request.formData();

        const upload = [form.get("resume"), form.get("cover_letter")].find(
          (value) => value instanceof File,
        );

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
