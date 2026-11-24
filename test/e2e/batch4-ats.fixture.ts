import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { BATCH_4_ATS, isBatchFourAts } from "../../src/shared/ats.ts";

export { BATCH_4_ATS as HOSTED_BOARD_NAMES } from "../../src/shared/ats.ts";

const FIXTURE_FORMS_DIR = join(process.cwd(), "test/e2e/fixtures/batch4");

const hostedOptionSchema = z.object({ label: z.string(), value: z.string() });

const hostedFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  options: z.array(hostedOptionSchema).optional(),
});

const hostedSectionSchema = z.object({
  name: z.string(),
  fields: z.array(hostedFieldSchema),
});

const hostedFormSchema = z.array(hostedSectionSchema);

type HostedField = z.infer<typeof hostedFieldSchema>;

type HostedSection = z.infer<typeof hostedSectionSchema>;

type HostedBoard = (typeof BATCH_4_ATS)[number];

export interface HostedBoardState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  lastForm: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
  /** The field the page omits while the fixture's form still lists it, for a form-change test. */
  omitField: string | null;
  /** A required question the plan cannot answer, so preparation must open a Review. */
  extraRequiredQuestion: boolean;
  /** Whether a successful submit shows the confirmation page; "none" keeps the form, for the confirming test. */
  confirmation: "page" | "none";
}

export interface HostedBoardsFixture {
  url: string;
  state: Record<HostedBoard, HostedBoardState>;
  close: () => void;
}

const FORM_MARKUP: Record<HostedBoard, string> = {
  applicantpro: 'id="application-form" class="application-form applicantpro-apply"',
  catsone: 'class="application-form" data-catsone-apply="true"',
  gem: 'id="gem-application-form" class="application-form"',
  hiringthing: 'id="hiringthing-apply" class="application-form"',
  isolved_hire: 'id="isolvedhire-application-form" class="application-form"',
  onlyfy: 'id="onlyfy-application-form" class="application-form"',
  rippling: 'class="application-form" data-testid="rippling-application-form"',
  varbi: 'id="varbi-application-form" class="application-form"',
};

const EXTRA_QUESTION = {
  id: "current_job_title",
  label: "What is your current job title?",
  type: "text",
  required: true,
} satisfies HostedField;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function renderControl(field: HostedField) {
  const required = field.required === true ? " required" : "";
  const id = escapeHtml(field.id);

  switch (field.type) {
    case "email":
    case "tel":
    case "text":
    case "date":
    case "number": {
      return `<input id="${id}" name="${id}" type="${field.type}"${required}>`;
    }

    case "textarea": {
      return `<textarea id="${id}" name="${id}"${required}></textarea>`;
    }

    case "file": {
      return `<input id="${id}" name="${id}" type="file" accept="application/pdf"${required}>`;
    }

    case "radio": {
      const options = field.options ?? [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" },
      ];

      return options
        .map((option, index) => {
          const optionId = `${id}_${String(index)}`;

          return `<input id="${escapeHtml(optionId)}" type="radio" name="${id}" value="${escapeHtml(option.value)}"${required}> <label for="${escapeHtml(optionId)}">${escapeHtml(option.label)}</label>`;
        })
        .join("");
    }

    case "checkbox": {
      return `<input id="${id}" name="${id}" type="checkbox" value="Yes"${required}>`;
    }

    default: {
      return "";
    }
  }
}

function fieldBlock(field: HostedField) {
  const control = renderControl(field);

  if (control === "") {
    return "";
  }

  if (field.type === "radio") {
    return `<fieldset class="form-field" data-field="${escapeHtml(field.id)}">
    <legend>${escapeHtml(field.label)}${field.required === true ? ' <span class="required">*</span>' : ""}</legend>
    ${control}
  </fieldset>`;
  }

  return `<div class="form-field" data-field="${escapeHtml(field.id)}">
    <label for="${escapeHtml(field.id)}">${escapeHtml(field.label)}${field.required === true ? ' <span class="required">*</span>' : ""}</label>
    ${control}
  </div>`;
}

function renderPage(input: {
  board: HostedBoard;
  jobId: string;
  sections: HostedSection[];
  state: HostedBoardState;
}) {
  const extra = input.state.extraRequiredQuestion ? [EXTRA_QUESTION] : [];

  const body = [
    ...input.sections,
    ...(extra.length === 0 ? [] : [{ name: "Screening", fields: extra }]),
  ]
    .map(
      (section) =>
        `<section class="form-section"><h2>${escapeHtml(section.name)}</h2>${section.fields
          .map(fieldBlock)
          .join("\n")}</section>`,
    )
    .join("\n")
    .replace(
      new RegExp(
        String.raw`<div class="form-field" data-field="${escapeHtml(input.state.omitField ?? "__none__")}">[\s\S]*?</div>`,
        "u",
      ),
      "",
    );

  const action = `/${input.board}/apply/${encodeURIComponent(input.jobId)}`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Apply</title></head>
<body>
<main>
  <h1>Apply for this role</h1>
  <form ${FORM_MARKUP[input.board]} data-apply-url="${escapeHtml(action)}" data-confirmation="${input.state.confirmation}">
    ${body}
    <p id="form-error" role="alert"></p>
    <button type="submit">Submit application</button>
  </form>
</main>
<script>
  document.querySelector("form.application-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const response = await fetch(form.dataset.applyUrl, { body: new FormData(form), method: "POST" });

    if (!response.ok) {
      document.querySelector("#form-error").textContent = "The application was refused.";
      return;
    }

    if (form.dataset.confirmation === "none") {
      return;
    }

    document.body.innerHTML = "<main><h1>Thank you for applying</h1><p>Your application has been received.</p></main>";
  });
</script>
</body>
</html>`;
}

function renderLoginGate() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<main>
  <h1>Sign in to continue</h1>
  <p>You must sign in to continue to the application form.</p>
  <form method="post" action="/login">
    <label for="email">Email</label><input id="email" name="email" type="email">
    <label for="password">Password</label><input id="password" name="password" type="password">
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}

const emptyState = () =>
  ({
    applicationRequests: 0,
    confirmation: "page",
    extraRequiredQuestion: false,
    formLoads: 0,
    lastForm: {},
    lastResumeBytes: null,
    omitField: null,
    submissions: 0,
  }) satisfies HostedBoardState;

/**
 * Serves the Batch 4 boards' deterministic application forms from one local server. Each board gets its own
 * markup (the adapter's selector), form JSON, login gate and submission state, so a test can drive the real
 * prepare and send pipelines without any live traffic.
 *
 * @returns The fixture URL, each board's state and a close function.
 */
export function startHostedBoardsFixture() {
  const sectionsByBoard = new Map<HostedBoard, HostedSection[]>(
    BATCH_4_ATS.map((board) => [
      board,
      hostedFormSchema.parse(
        JSON.parse(readFileSync(join(FIXTURE_FORMS_DIR, `${board}.form.json`), "utf8")),
      ),
    ]),
  );

  const state: Record<HostedBoard, HostedBoardState> = {
    applicantpro: emptyState(),
    catsone: emptyState(),
    gem: emptyState(),
    hiringthing: emptyState(),
    isolved_hire: emptyState(),
    onlyfy: emptyState(),
    rippling: emptyState(),
    varbi: emptyState(),
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter((part) => part !== "");

      if (url.pathname === "/__fixture__/state") {
        const board = url.searchParams.get("board");

        if (board === null || !isBatchFourAts(board)) {
          return Response.json({ error: "unknown board" }, { status: 404 });
        }

        const entry = state[board];

        return Response.json({
          applicationRequests: entry.applicationRequests,
          formLoads: entry.formLoads,
          submissions: entry.submissions,
        });
      }

      const [board = "", kind = "", rawJobId = ""] = parts;

      if (!isBatchFourAts(board)) {
        return new Response("not found", { status: 404 });
      }

      const entry = state[board];
      const jobId = decodeURIComponent(rawJobId);
      const sections = sectionsByBoard.get(board) ?? [];

      if (kind === "apply" && request.method === "POST") {
        entry.applicationRequests += 1;

        const form = await request.formData();
        const files: File[] = [];

        for (const section of sections) {
          for (const field of section.fields) {
            const value = form.get(field.id);

            if (value === null) {
              continue;
            }

            if (value instanceof File) {
              files.push(value);

              continue;
            }

            entry.lastForm[field.id] = value;
          }
        }

        await Promise.all(
          files.map(async (file) => {
            entry.lastResumeBytes = new Uint8Array(await file.arrayBuffer());
          }),
        );

        entry.submissions += 1;

        return Response.json({ ok: true }, { status: 201 });
      }

      if (kind === "gated" && request.method === "GET") {
        entry.formLoads += 1;

        return new Response(renderLoginGate(), { headers: { "content-type": "text/html" } });
      }

      if (kind === "apply" && request.method === "GET") {
        entry.formLoads += 1;

        return new Response(
          renderPage({
            board,
            jobId,
            sections,
            state: entry,
          }),
          { headers: { "content-type": "text/html" } },
        );
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: server.url.toString().replace(/\/$/u, ""),
    state,
    close: () => {
      void server.stop(true);
    },
  } satisfies HostedBoardsFixture;
}
