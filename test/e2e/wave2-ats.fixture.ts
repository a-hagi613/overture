import type { WAVE_2_ATS } from "../../src/shared/ats.ts";

export { WAVE_2_ATS as WAVE_2_BOARD_NAMES } from "../../src/shared/ats.ts";

type WaveTwoBoard = (typeof WAVE_2_ATS)[number];

export interface WaveTwoBoardState {
  submissions: number;
  applicationRequests: number;
  formLoads: number;
  consentLoads: number;
  lastForm: Record<string, string>;
  lastResumeBytes: Uint8Array | null;
  closed: boolean;
}

export interface WaveTwoBoardsFixture {
  url: string;
  state: Record<WaveTwoBoard, WaveTwoBoardState>;
  close: () => void;
}

const SPONSORSHIP_PROMPT =
  "Will you now, or in the future, require visa sponsorship to legally work in the country where this role is based?";

const JOBVITE_APPLY_FIELDS = [
  { fieldType: "Name", name: "First Name", required: true, fieldId: -1, viewFieldEId: "fn" },
  { fieldType: "Name", name: "Last Name", required: true, fieldId: -2, viewFieldEId: "ln" },
  { fieldType: "Email", name: "Email Address", required: true, fieldId: -3, viewFieldEId: "em" },
  { fieldType: "Phone", name: "Phone", required: false, fieldId: -8, viewFieldEId: "ph" },
  {
    fieldType: "DropDown",
    name: "Country of residence",
    required: true,
    fieldId: -7,
    viewFieldEId: "co",
    values: [
      { key: "Canada", value: "Canada" },
      { key: "United States", value: "United States" },
    ],
  },
];

const JOBVITE_PRESCREEN_FIELDS = {
  name: "Screening",
  section: [
    {
      element: [
        {
          elementNo: "0",
          required: false,
          fields: [
            {
              fieldId: "f0",
              fieldType: "Radio",
              name: SPONSORSHIP_PROMPT,
              required: true,
              values: [
                { key: "No", value: "No" },
                { key: "Yes", value: "Yes" },
              ],
            },
          ],
        },
        {
          elementNo: "1",
          required: false,
          fields: [
            {
              fieldId: "f1",
              fieldType: "CheckBox",
              name: "Which languages do you speak?",
              required: true,
              values: [
                { key: "English", value: "English" },
                { key: "French", value: "French" },
              ],
            },
          ],
        },
        {
          elementNo: "2",
          required: false,
          fields: [{ fieldId: "f2", fieldType: "Name", name: "City", required: true }],
        },
      ],
    },
  ],
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const JOBVITE_PRELOADED = JSON.stringify({
  applyFields: JOBVITE_APPLY_FIELDS,
  preScreeningFormFields: JOBVITE_PRESCREEN_FIELDS,
});

function renderConsentPage(action: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Data consent</title></head>
<body>
<h1>Data Consent</h1>
<form name="consentForm" class="jv-form" method="get" action="${escapeHtml(action)}">
  <label for="jv-country-select">Location of Residence and Language</label>
  <select id="jv-country-select" name="consent">
    <option value="">Select your location of residence and language</option>
    <option value="all">All Countries</option>
  </select>
  <button type="submit">I Accept</button>
</form>
<script>
  angular.module('preloadedData', []).constant('preloadedData', ${JOBVITE_PRELOADED});
</script>
</body></html>`;
}

function renderJobvitePage(jobId: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Apply</title></head>
<body>
<main>
  <h1>Apply for this role</h1>
  <form name="scopeData.applyForm" data-job-id="${escapeHtml(jobId)}">
    <div id="step1">
      <div><label for="jv-field-fn">First Name*</label><input id="jv-field-fn" name="input-fn" type="text" required></div>
      <div><label for="jv-field-ln">Last Name*</label><input id="jv-field-ln" name="input-ln" type="text" required></div>
      <div><label for="jv-field-em">Email Address*</label><input id="jv-field-em" name="input-em" type="email" required></div>
      <div><label for="jv-field-ph">Phone</label><input id="jv-field-ph" name="input-ph" type="tel"></div>
      <div><label for="jv-field-co">Country of residence*</label>
        <select id="jv-field-co" name="input-co" required>
          <option value="">Select an option...</option>
          <option value="Canada">Canada</option>
          <option value="United States">United States</option>
        </select>
      </div>
      <h3 id="jv-resume-header">Add Resume*</h3>
      <div id="attachResume"><ul class="jv-file-list"></ul></div>
      <input id="file-input-0" type="file" accept="application/pdf" style="position:absolute;width:1px;height:1px;opacity:0">
      <button type="button" ng-click="nextStep()">Next →</button>
    </div>
    <div id="step2" hidden>
      <fieldset>
        <legend>${escapeHtml(SPONSORSHIP_PROMPT)}*</legend>
        <label><input id="jv-field-f0-0" name="f0" type="radio" value="No" required> No</label>
        <label><input id="jv-field-f0-1" name="f0" type="radio" value="Yes" required> Yes</label>
      </fieldset>
      <fieldset>
        <legend>Which languages do you speak?*</legend>
        <label><input id="jv-field-f1-0" name="f1" type="checkbox" value="English"> English</label>
        <label><input id="jv-field-f1-1" name="f1" type="checkbox" value="French"> French</label>
      </fieldset>
      <div><label for="jv-field-f2">City*</label><input id="jv-field-f2" name="input-f2" type="text" required></div>
      <div><label for="jv-field-f3">Anything else?</label><textarea id="jv-field-f3" name="input-f3"></textarea></div>
      <button type="submit">Send Application</button>
    </div>
  </form>
</main>
<script>
  angular.module('preloadedData', []).constant('preloadedData', ${JOBVITE_PRELOADED});
</script>
<script>
  const form = document.querySelector("form[name='scopeData.applyForm']");
  let resumeFile = null;

  document.querySelector("#file-input-0").addEventListener("change", (event) => {
    resumeFile = event.target.files[0] ?? null;
    document.querySelector("#attachResume .jv-file-list").textContent = resumeFile ? resumeFile.name : "";
  });

  form.querySelector("button[ng-click='nextStep()']").addEventListener("click", (event) => {
    event.currentTarget.remove();
    document.querySelector("#step1").hidden = true;
    document.querySelector("#step2").hidden = false;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);

    if (resumeFile) {
      data.append("resumes", resumeFile);
    }

    const response = await fetch(window.location.pathname, { body: data, method: "POST" });

    if (!response.ok) {
      return;
    }

    document.body.innerHTML = "<main><h1>Thank you for applying</h1><p>Your application has been received.</p></main>";
  });
</script>
</body></html>`;
}

const HERP_PROPS = {
  applyForm: {
    career: "invisible",
    careerSummaries: "visible",
    currentAnnualSalary: "invisible",
    currentCompany: "visible",
    dateOfBirth: "invisible",
    education: "invisible",
    id: "form-1",
    links: "invisible",
    messageToCompany: "invisible",
    minDesiredSalary: "invisible",
    namePronunciation: "invisible",
    otherFile: "visible",
    resume: "visible",
    telephoneNumber: "visible",
  },
  applyFormPage: true,
  careerPageId: "HP-1001",
  companySlug: "acme",
  i18n: {
    default: {
      career: { label: "Work Experience" },
      cv: { label: "CV" },
      email: { label: "Email" },
      message: { label: "Message to us" },
      name: { label: "Name" },
      otherFiles: { label: "Other related files" },
      phone: { label: "Phone" },
      privacyPolicy: { ariaLabel: "Agree to the Privacy Policy" },
      resume: { label: "Resume" },
    },
  },
};

function renderHerpPage(jobId: string, state: WaveTwoBoardState) {
  const closed = state.closed ? `<p>This job is no longer accepting applications.</p>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Apply</title></head>
<body>
<main>
  ${closed}
  <h1>Apply for this role</h1>
  <form method="post" enctype="multipart/form-data" data-job-id="${escapeHtml(jobId)}">
    <div class="form__component" data-field="name">
      <div class="labeled-form-item__label">Name</div>
      <input name="name" type="text" aria-label="Name" required>
    </div>
    <div class="form__component" data-field="email">
      <div class="labeled-form-item__label">Email</div>
      <input name="email" type="email" aria-label="Email" required>
    </div>
    <div class="form__component" data-field="telephoneNumber">
      <div class="labeled-form-item__label">Phone</div>
      <input name="telephoneNumber" type="tel" aria-label="Phone">
    </div>
    <div class="form__component" data-field="career">
      <div class="labeled-form-item__label">Work Experience</div>
      <textarea name="career" aria-label="Work Experience"></textarea>
    </div>
    <div class="form__component" data-field="messageToCompany">
      <div class="labeled-form-item__label">Message to us</div>
      <textarea name="messageToCompany" aria-label="Message to us"></textarea>
    </div>
    <div class="form__component" data-field="resumes">
      <div class="labeled-form-item__label">Resume</div>
      <input name="resumes" type="file" aria-label="Upload resume" accept="application/pdf" multiple>
    </div>
    <div class="form__component" data-field="careerSummaries">
      <div class="labeled-form-item__label">CV</div>
      <input name="careerSummaries" type="file" aria-label="Upload CV" multiple>
    </div>
    <div class="form__component" data-field="otherFiles">
      <div class="labeled-form-item__label">Other related files</div>
      <input name="otherFiles" type="file" aria-label="Upload other related files" multiple>
    </div>
    <button type="button" class="button -primary js-preview" data-action="enter">Confirm application</button>
    <button type="submit" class="button -primary">Submit Application</button>
    <label><input name="privacyPolicy" type="checkbox" value="true" aria-label="Agree to the Privacy Policy"> Agree to the Privacy Policy</label>
  </form>
</main>
<script id="herp-react-props" type="application/json">${JSON.stringify(HERP_PROPS)}</script>
<script>
  const form = document.querySelector("form");

  form.querySelector("button[data-action='enter']").addEventListener("click", (event) => {
    event.currentTarget.remove();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const response = await fetch(window.location.pathname, {
      body: new FormData(form),
      method: "POST",
    });

    if (!response.ok) {
      return;
    }

    document.body.innerHTML = "<main><h1>Thank you for applying</h1><p>Your application has been received.</p></main>";
  });
</script>
</body></html>`;
}

function renderLoginGate() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in</title></head>
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
</body></html>`;
}

const emptyState = () =>
  ({
    applicationRequests: 0,
    closed: false,
    consentLoads: 0,
    formLoads: 0,
    lastForm: {},
    lastResumeBytes: null,
    submissions: 0,
  }) satisfies WaveTwoBoardState;

async function recordSubmission(request: Request, state: WaveTwoBoardState) {
  state.applicationRequests += 1;

  const form = await request.formData();

  const uploads: File[] = [];

  for (const name of form.keys()) {
    const value = form.get(name);

    if (value === null) {
      continue;
    }

    if (value instanceof File) {
      if (value.size > 0 && value.name !== "") {
        uploads.push(value);
      }

      continue;
    }

    state.lastForm[name] = value;
  }

  const buffers = await Promise.all(
    uploads.map(async (file) => new Uint8Array(await file.arrayBuffer())),
  );

  const [lastUpload] = buffers;

  if (lastUpload !== undefined) {
    state.lastResumeBytes = lastUpload;
  }

  state.submissions += 1;
}

/**
 * Serves both Wave 2 boards' guest application forms from one local server, with the
 * consent gate, multi-step Jobvite form, HERP preview step, login gate and closed-job
 * state the adapters must handle. No application ever reaches a real employer.
 *
 * @returns The fixture URL, each board's state and a close function.
 */
export function startWaveTwoBoardsFixture() {
  const state: Record<WaveTwoBoard, WaveTwoBoardState> = {
    herp: emptyState(),
    jobvite: emptyState(),
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter((part) => part !== "");

      if (url.pathname === "/__fixture__/state") {
        const board = url.searchParams.get("board");

        if (board !== "jobvite" && board !== "herp") {
          return Response.json({ error: "unknown board" }, { status: 404 });
        }

        const entry = state[board];

        return Response.json({
          applicationRequests: entry.applicationRequests,
          formLoads: entry.formLoads,
          submissions: entry.submissions,
        });
      }

      if (parts.includes("gated")) {
        return new Response(renderLoginGate(), { headers: { "content-type": "text/html" } });
      }

      const isHerp = parts[0] === "v1";
      const board: WaveTwoBoard = isHerp ? "herp" : "jobvite";
      const entry = state[board];
      const jobId = decodeURIComponent(isHerp ? (parts[2] ?? "") : (parts[2] ?? ""));

      if (request.method === "POST") {
        await recordSubmission(request, entry);

        return Response.json({ ok: true }, { status: 201 });
      }

      if (isHerp) {
        entry.formLoads += 1;

        return new Response(renderHerpPage(jobId, entry), {
          headers: { "content-type": "text/html" },
        });
      }

      if (url.searchParams.get("consent") === null) {
        entry.consentLoads += 1;

        return new Response(renderConsentPage(url.pathname), {
          headers: { "content-type": "text/html" },
        });
      }

      entry.formLoads += 1;

      return new Response(renderJobvitePage(jobId), {
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
  } satisfies WaveTwoBoardsFixture;
}
