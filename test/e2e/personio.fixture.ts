import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const applicationBodySchema = z.record(z.string(), z.string());

const TEMPLATE = readFileSync(
  join(process.cwd(), "test/e2e/fixtures/forms/personio/apply.fixture.html"),
  "utf8",
);

export type PersonioVariant = "standard" | "custom" | "documents";

export interface PersonioFixtureState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  documents: { name: string; bytes: Uint8Array }[];
  lastForm: Record<string, string>;
}

export interface PersonioFixture {
  url: string;
  state: PersonioFixtureState;
  applyUrl: (jobId: string) => string;
  close: () => void;
}

interface PersonioFixtureOptions {
  variant?: PersonioVariant;
}

const CUSTOM_FIELDS = `
  <label for="field-custom_attribute_1001">LinkedIn profile</label>
  <input id="field-custom_attribute_1001" name="custom_attribute_1001" type="text" maxlength="5000" />
  <label for="field-custom_attribute_1002">Are you authorized to work in Germany?<span aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
  <select id="field-custom_attribute_1002" name="custom_attribute_1002">
    <option value="" selected>Please choose</option>
    <option value="custom_option_2001">Yes</option>
    <option value="custom_option_2002">No</option>
  </select>
  <label for="field-custom_attribute_1003">Earliest start date</label>
  <input id="field-custom_attribute_1003" name="custom_attribute_1003" type="date" />
`;

const DOCUMENT_CATEGORIES = `
  <div role="group" aria-labelledby="doc-label-cover-letter">
    <div id="doc-label-cover-letter">Cover letter<span> (Optional)</span></div>
    <div class="document-input-wrapper">
      <button type="button">Add file</button>
      <input
        id="doc-input-cover-letter"
        name="documents.cover-letter"
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.doc"
      />
    </div>
  </div>
`;

const TEXT = {
  de: {
    addFile: "Datei hinzufügen",
    applyHeading: "Deine Bewerbung",
    available: "Verfügbar ab",
    birthday: "Geburtsdatum",
    company: "Musterfirma",
    cv: "Lebenslauf",
    documents: "Dokumente",
    email: "E-Mail",
    first: "Vorname",
    gender: "Geschlecht",
    genderFemale: "Weiblich",
    genderMale: "Männlich",
    genderDiverse: "Divers",
    last: "Nachname",
    name: "Name",
    phone: "Telefon",
    placeholder: "Bitte auswählen",
    submit: "Bewerbung senden",
    title: "Senior Backend Engineer",
  },
  en: {
    addFile: "Add file",
    applyHeading: "Your application",
    available: "Available from",
    birthday: "Date of birth",
    company: "Musterfirma",
    cv: "Resume",
    documents: "Documents",
    email: "Email",
    first: "First name",
    gender: "Gender",
    genderFemale: "Female",
    genderMale: "Male",
    genderDiverse: "Diverse",
    last: "Last name",
    name: "Name",
    phone: "Phone",
    placeholder: "Please choose",
    submit: "Send application",
    title: "Senior Backend Engineer",
  },
} as const;

function render(jobId: string, variant: PersonioVariant, index: number) {
  const language = index % 2 === 0 ? "de" : "en";
  const text = TEXT[language];

  return TEMPLATE.replaceAll("__JOB_ID__", jobId)
    .replaceAll("__LANGUAGE__", language)
    .replaceAll("__TITLE__", text.title)
    .replaceAll("__COMPANY__", text.company)
    .replaceAll("__APPLY_HEADING__", text.applyHeading)
    .replaceAll("__NAME_HEADING__", text.name)
    .replaceAll("__FIRST_NAME__", text.first)
    .replaceAll("__LAST_NAME__", text.last)
    .replaceAll("__EMAIL_LABEL__", text.email)
    .replaceAll("__PHONE_LABEL__", text.phone)
    .replaceAll("__AVAILABLE_LABEL__", text.available)
    .replaceAll("__GENDER_LABEL__", text.gender)
    .replaceAll("__GENDER_FEMALE__", text.genderFemale)
    .replaceAll("__GENDER_MALE__", text.genderMale)
    .replaceAll("__GENDER_DIVERSE__", text.genderDiverse)
    .replaceAll("__SELECT_PLACEHOLDER__", text.placeholder)
    .replaceAll("__BIRTHDAY_LABEL__", text.birthday)
    .replaceAll("__DOCUMENTS_HEADING__", text.documents)
    .replaceAll("__CV_LABEL__", text.cv)
    .replaceAll("__ADD_FILE__", text.addFile)
    .replaceAll("__SUBMIT_LABEL__", text.submit)
    .replaceAll("__CUSTOM_FIELDS__", variant === "custom" ? CUSTOM_FIELDS : "")
    .replaceAll("__DOCUMENT_CATEGORIES__", variant === "documents" ? DOCUMENT_CATEGORIES : "");
}

/**
 * Serves Personio's server-rendered apply pages and its document and
 * application endpoints locally, so no test reaches a live ATS (ADR 0016).
 *
 * @param options the form variant this job serves
 * @returns the fixture's URL and its recorded state
 */
export function startPersonioFixture(options: PersonioFixtureOptions = {}) {
  const variant = options.variant ?? "standard";
  const indexByJob = new Map<string, number>();

  const state: PersonioFixtureState = {
    applicationRequests: 0,
    documents: [],
    formLoads: 0,
    lastForm: {},
    submissions: 0,
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/__fixture__/state") {
        return Response.json({
          applicationRequests: state.applicationRequests,
          documents: state.documents.map((document) => ({
            bytes: document.bytes.byteLength,
            name: document.name,
          })),
          formLoads: state.formLoads,
          submissions: state.submissions,
        });
      }

      if (path === "/api/v1/documents" && request.method === "POST") {
        const form = await request.formData();
        const upload = form.get("file");

        if (upload instanceof File) {
          state.documents.push({
            bytes: new Uint8Array(await upload.arrayBuffer()),
            name: upload.name,
          });
        }

        return Response.json({ ok: true }, { status: 201 });
      }

      const application = /^\/api\/v1\/jobs\/(?<job>\d+)\/application$/u.exec(path);

      if (application?.groups?.job !== undefined && request.method === "POST") {
        state.applicationRequests += 1;
        state.submissions += 1;

        const raw: unknown = await request.json().catch(() => null);
        const body = applicationBodySchema.safeParse(raw);

        if (body.success) {
          for (const [key, value] of Object.entries(body.data)) {
            state.lastForm[key] = value;
          }
        }

        return Response.json({ ok: true }, { status: 201 });
      }

      const jobPage = /^\/job\/(?<job>\d+)$/u.exec(path);

      if (jobPage?.groups?.job !== undefined) {
        const jobId = jobPage.groups.job;
        const language = url.searchParams.get("language") ?? "en";

        return new Response(
          `<!doctype html><html lang="${language}"><body><p>Musterfirma</p><h1>Senior Backend Engineer</h1><a href="/job/${jobId}/apply?language=${language}">Apply</a></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }

      const applyPage = /^\/job\/(?<job>\d+)\/apply$/u.exec(path);

      if (applyPage?.groups?.job !== undefined && request.method === "GET") {
        const jobId = applyPage.groups.job;
        const index = indexByJob.get(jobId) ?? indexByJob.size;

        indexByJob.set(jobId, index);
        state.formLoads += 1;

        return new Response(render(jobId, variant, index), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  const url = server.url.toString().replace(/\/$/u, "");

  return {
    state,
    url,
    applyUrl: (jobId: string) => `${url}/job/${jobId}/apply?language=en`,
    close: () => {
      void server.stop(true);
    },
  } satisfies PersonioFixture;
}
