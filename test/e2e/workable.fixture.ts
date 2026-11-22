import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const FIXTURE_FORMS_DIR = join(process.cwd(), "test/e2e/fixtures/workable/forms");

const workableOptionSchema = z.object({ name: z.string(), value: z.string() });

const workableFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  options: z.array(workableOptionSchema).optional(),
});

const workableSectionSchema = z.object({
  name: z.string(),
  fields: z.array(workableFieldSchema),
});

const workableSectionsSchema = z.array(workableSectionSchema);

type WorkableField = z.infer<typeof workableFieldSchema>;

type WorkableSection = z.infer<typeof workableSectionSchema>;

export interface WorkableFixturesState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  lastForm: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
  /** The field the page omits while the form endpoint still lists it, for a form-change test. */
  omitField: string | null;
  /** Whether a successful submit shows the confirmation page; "none" keeps the form, for the confirming test. */
  confirmation: "page" | "none";
  /** The shortcode the last apply page was served for, so a mismatch test can point at another one. */
  pageJobId: string | null;
}

export interface WorkableFixture {
  url: string;
  state: WorkableFixturesState;
  close: () => void;
}

export interface WorkableFixtureOptions {
  jobId?: string;
  title?: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function renderControl(field: WorkableField) {
  const required = field.required === true ? " required" : "";
  const id = escapeHtml(field.id);

  switch (field.type) {
    case "email":
    case "phone":
    case "date":
    case "number":
    case "text":
    case "string": {
      return `<input id="${id}" name="${id}" type="${field.type === "string" ? "text" : field.type}"${required}>`;
    }

    case "paragraph":
    case "free_text": {
      return `<textarea id="${id}" name="${id}"${required}></textarea>`;
    }

    case "file": {
      return `<input id="${id}" name="${id}" type="file" accept="application/pdf"${required}>`;
    }

    case "dropdown": {
      const options = (field.options ?? [])
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}">${escapeHtml(option.value)}</option>`,
        )
        .join("");

      return `<select id="${id}" name="${id}"${required}><option value="">Select…</option>${options}</select>`;
    }

    case "boolean": {
      return `<label><input type="radio" name="${id}" value="Yes"${required}> Yes</label>
        <label><input type="radio" name="${id}" value="No"> No</label>`;
    }

    case "multiple": {
      return (field.options ?? [])
        .map(
          (option) =>
            `<label><input type="checkbox" name="${id}" value="${escapeHtml(option.value)}"> ${escapeHtml(option.value)}</label>`,
        )
        .join("");
    }

    default: {
      return "";
    }
  }
}

function fieldBlock(field: WorkableField) {
  const control = renderControl(field);

  if (control === "") {
    return "";
  }

  return `<div class="form-field" data-field="${escapeHtml(field.id)}">
    <label for="${escapeHtml(field.id)}">${escapeHtml(field.label)}${field.required === true ? ' <span class="required">*</span>' : ""}</label>
    ${control}
  </div>`;
}

function renderPage(
  sections: WorkableSection[],
  state: WorkableFixturesState,
  jobId: string,
  title: string,
) {
  const body = sections
    .map(
      (section) =>
        `<section class="form-section"><h2>${escapeHtml(section.name)}</h2>${section.fields
          .map(fieldBlock)
          .join("\n")}</section>`,
    )
    .join("\n")
    .replace(
      new RegExp(
        String.raw`<div class="form-field" data-field="${escapeHtml(state.omitField ?? "__none__")}">[\s\S]*?</div>`,
        "u",
      ),
      "",
    );

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <form class="application-form" id="application-form" data-ui="application-form" data-apply-url="/api/v1/jobs/${encodeURIComponent(jobId)}/apply" data-confirmation="${state.confirmation}">
    ${body}
    <p id="form-error" role="alert"></p>
    <button type="submit">Submit application</button>
  </form>
</main>
<script>
  document.querySelector("form#application-form").addEventListener("submit", async (event) => {
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

export function startWorkableFixture(options: WorkableFixtureOptions = {}) {
  const jobId = options.jobId ?? "WK-1001";
  const title = options.title ?? "Senior Platform Engineer";

  const sections = workableSectionsSchema.parse(
    JSON.parse(readFileSync(join(FIXTURE_FORMS_DIR, `${jobId}.form.json`), "utf8")),
  );

  const state: WorkableFixturesState = {
    submissions: 0,
    applicationRequests: 0,
    formLoads: 0,
    lastForm: {},
    lastResumeBytes: null,
    omitField: null,
    confirmation: "page",
    pageJobId: null,
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/__fixture__/state") {
        return Response.json({
          applicationRequests: state.applicationRequests,
          formLoads: state.formLoads,
          submissions: state.submissions,
        });
      }

      if (path === `/api/v1/jobs/${jobId}/form`) {
        state.formLoads += 1;

        return Response.json(sections);
      }

      if (path === `/api/v1/jobs/${jobId}/apply` && request.method === "POST") {
        state.applicationRequests += 1;

        const form = await request.formData();

        await Promise.all(
          sections.flatMap((section) =>
            section.fields.map(async (field) => {
              const value = form.get(field.id);

              if (value === null) {
                return;
              }

              if (value instanceof File) {
                state.lastResumeBytes = new Uint8Array(await value.arrayBuffer());

                return;
              }

              state.lastForm[field.id] = value;
            }),
          ),
        );

        state.submissions += 1;

        return Response.json({ ok: true }, { status: 201 });
      }

      const pageMatch = /^\/j\/(?<id>[^/]+)$/u.exec(path);

      if (pageMatch?.groups !== undefined && request.method === "GET") {
        const pageJobId = pageMatch.groups["id"] ?? jobId;

        state.formLoads += 1;
        state.pageJobId = pageJobId;

        return new Response(renderPage(sections, state, pageJobId, title), {
          headers: { "content-type": "text/html" },
        });
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
  } satisfies WorkableFixture;
}
