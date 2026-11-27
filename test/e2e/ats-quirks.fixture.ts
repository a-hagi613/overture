import { z } from "zod";

export const CONFIRMATION_HTML = `<!doctype html>
<html lang="en"><body><h1>Thank you for applying</h1><p>Your application has been received.</p></body></html>`;

const uploadedSchema = z.object({ file: z.string(), name: z.string() });

interface FixtureUpload {
  file: string;
  name: string;
}

interface ServedAtsPage {
  url: string;
  posts: { fields: Record<string, string>; files: Record<string, string>; path: string }[];
  uploads: FixtureUpload[];
  close: () => void;
}

export function startAtsPage(html: string) {
  const posts: ServedAtsPage["posts"] = [];
  const uploads: FixtureUpload[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/__fixture__/uploaded" && request.method === "POST") {
        uploads.push(uploadedSchema.parse(await request.json()));

        return Response.json({ recorded: true });
      }

      if (request.method !== "POST") {
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
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
    url: server.url.toString().replace(/\/$/u, ""),
    posts,
    uploads,
    close: () => {
      void server.stop(true);
    },
  } satisfies ServedAtsPage;
}

function uploadListener() {
  return `<script>
  for (const input of document.querySelectorAll("input[type='file']")) {
    input.addEventListener("change", () => {
      void fetch("/__fixture__/uploaded", {
        body: JSON.stringify({ file: input.files?.[0]?.name ?? "", name: input.name }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    });
  }
</script>`;
}

export const greenhousePage = (action: string) => `<!doctype html><html lang="en">
<head><title>Platform Engineer at Example</title><script type="application/json">{"submitPath":"${action}"}</script></head>
<body>
<form id="application_form" method="post" action="${action}" enctype="multipart/form-data">
  <label for="first_name">First name</label><input id="first_name" name="first_name" type="text" required>
  <label for="last_name">Last name</label><input id="last_name" name="last_name" type="text" required>
  <label for="email">Email</label><input id="email" name="email" type="email" required>
  <label for="resume">Resume/CV</label><input id="resume" name="resume" type="file" required>
  <button type="submit">Submit application</button>
</form>
<form id="decoy" method="post" action="/decoy">
  <label for="decoy_email">Email</label><input id="decoy_email" name="email" type="email" value="decoy@example.com">
  <button type="submit">Subscribe</button>
</form>
</body>
</html>`;

export const greenhouseLiveShapePage = (
  action: string,
  options: { changed?: boolean } = {},
) => `<!doctype html>
<html lang="en">
<head><title>Platform Engineer at Example</title><script type="application/json">{"submitPath":"${action}"}</script></head>
<body>
<form id="application_form" method="post" action="${action}" enctype="multipart/form-data">
  <div class="field-wrapper">
    <label for="first_name">First name</label>
    <input id="first_name" name="first_name" type="text" required>
  </div>
  <div class="field-wrapper">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required>
  </div>
  <div class="field-wrapper">
    <label for="phone_number">Phone</label>
    <input id="phone_number" name="phone_number" type="tel" value="+1">
  </div>
  <div class="field-wrapper">
    <label for="country_field">Country</label>
    <select id="country_field" name="country_field">
      <option value="">Select…</option>
      <option value="CA">Canada</option>
      <option value="FR"${options.changed === true ? " selected" : ""}>France</option>
      <option value="US">United States</option>
    </select>
  </div>
  <div class="field-wrapper">
    <label for="candidate_location">Location (City)</label>
    <select id="candidate_location" name="candidate_location">
      <option value="">Select…</option>
      <option value="ottawa">Ottawa</option>
      <option value="toronto"${options.changed === true ? " selected" : ""}>Toronto</option>
    </select>
  </div>
  <div class="field-wrapper">
    <div class="file-upload">
      <div class="label">Resume/CV<span class="required">*</span></div>
      <span class="filename"></span>
      <input id="resume_upload" name="resume_file" class="visually-hidden" type="file" required>
    </div>
  </div>
  <button type="submit">Submit application</button>
</form>
</body>
</html>`;

export const leverLocationPage = (action: string, commit: boolean) => `<!doctype html>
<html lang="en">
<head><title>Example - Chief Of Staff</title></head>
<body>
<form id="application-form" method="post" action="${action}">
  <ul>
    <li class="application-question"><label><div class="application-label">Full name</div>
      <div class="application-field"><input name="name" type="text" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Email</div>
      <div class="application-field"><input name="email" type="email" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Current location <span class="required">✱</span></div>
      <div class="application-field">
        <input class="location-input" id="location-input" name="location" type="text" role="combobox" aria-controls="location-listbox" aria-expanded="false" required>
        <input type="hidden" id="selectedLocation" name="selectedLocation" value="">
        <div class="dropdown-results" id="location-listbox" role="listbox" hidden>
          <div role="option" data-value="loc-london">London, United Kingdom</div>
        </div>
      </div></label></li>
  </ul>
  <button id="btn-submit" type="submit">Submit application</button>
</form>
<script>
  const input = document.querySelector("#location-input");
  const list = document.querySelector("#location-listbox");
  input.addEventListener("input", () => { list.hidden = false; });
  for (const option of list.querySelectorAll("[role='option']")) {
    option.addEventListener("click", () => {
      input.value = option.textContent.trim();
      list.hidden = true;
      ${commit ? 'document.querySelector("#selectedLocation").value = option.dataset.value;' : ""}
    });
  }
</script>
</body>
</html>`;

export const leverResumeAutofillPage = (action: string) => `<!doctype html>
<html lang="en">
<head><title>Example - Chief Of Staff</title></head>
<body>
<form id="application-form" method="post" action="${action}" enctype="multipart/form-data">
  <ul>
    <li class="application-question"><label><div class="application-label">Email</div>
      <div class="application-field"><input name="email" type="email" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Resume/CV <span class="required">✱</span></div>
      <div class="application-field"><span class="filename"></span>
        <input id="resume-upload-input" name="resume" type="file">
        <span class="resume-upload-working"><div class="resume-upload-label">Analyzing resume...</div></span>
      </div></label></li>
  </ul>
  <button id="btn-submit" type="submit">Submit application</button>
</form>
<script>
  const resume = document.querySelector("#resume-upload-input");
  resume.addEventListener("change", () => {
    document.querySelector(".filename").textContent = resume.files?.[0]?.name ?? "";
    document.querySelector("[name='email']").value = "parser@example.com";
  });
</script>
${uploadListener()}
</body>
</html>`;

const ashbyShell = (body: string, extraScript = "") => `<!doctype html>
<html lang="en">
<head><title>Engineer @ Example</title></head>
<body>
<div class="ashby-job-posting-right-pane">
  <div class="ashby-application-form-autofill-uploader">
    <div class="ashby-application-form-autofill-input-root">
      <input type="file" id="autofill-resume">
      <h3>Autofill from resume</h3>
    </div>
  </div>
  <div class="ashby-application-form-container">
    ${body}
    <button class="ashby-application-form-submit-button" type="button">Submit application</button>
  </div>
</div>
${uploadListener()}
<script>
  document.querySelector(".ashby-application-form-submit-button").addEventListener("click", async () => {
    await fetch("/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction", {
      body: JSON.stringify({ variables: { fields: {} } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    for (const container of document.querySelectorAll(".ashby-application-form-container")) {
      container.remove();
    }
    const done = document.createElement("h1");
    done.textContent = "Thank you for applying. Your application has been received.";
    document.body.append(done);
  });
  ${extraScript}
</script>
</body>
</html>`;

export const ashbyResumePage = () =>
  ashbyShell(`<div class="ashby-application-form-field-entry">
      <label for="candidate-name">Name</label>
      <input id="candidate-name" name="_systemfield_name" type="text" required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="candidate-email">Email</label>
      <input id="candidate-email" name="_systemfield_email" type="email" required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="resume-attachment">Resume</label>
      <input id="resume-attachment" name="resume-upload" type="file" required>
    </div>`);

export const ashbyOverwritePage = () =>
  ashbyShell(
    `<div class="ashby-application-form-field-entry">
      <label for="candidate-email">Email</label>
      <input id="candidate-email" name="_systemfield_email" type="email" required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="privacy-consent">I agree to the privacy policy</label>
      <input id="privacy-consent" name="privacy-consent" type="checkbox" value="yes" checked required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="resume-attachment">Resume</label>
      <input id="resume-attachment" name="_systemfield_resume" type="file" required>
    </div>`,
    `document.querySelector("#resume-attachment").addEventListener("change", () => {
      document.querySelector("#candidate-email").value = "parser@example.com";
      document.querySelector("#privacy-consent").checked = false;
    });`,
  );

export const ashbyConsentPage = () =>
  ashbyShell(`<div class="ashby-application-form-field-entry">
      <label for="candidate-name">Name</label>
      <input id="candidate-name" name="_systemfield_name" type="text" required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label class="ashby-application-form-question-title" for="privacy-consent">I agree to the privacy policy</label>
      <input id="privacy-consent" name="privacy-consent" type="checkbox" value="yes" required>
    </div>`);

export const ashbyYesNoPage = () =>
  ashbyShell(
    `<div class="ashby-application-form-field-entry">
      <label for="candidate-name">Name</label>
      <input id="candidate-name" name="_systemfield_name" type="text" required>
    </div>
    <div class="ashby-application-form-field-entry">
      <label class="ashby-application-form-question-title" for="work-auth">Are you legally authorized to work in Canada?</label>
      <div class="ashby-application-form-input-yesno">
        <button type="button" class="ashby-application-form-input-yesno-option" aria-pressed="false">Yes</button>
        <button type="button" class="ashby-application-form-input-yesno-option" aria-pressed="false">No</button>
        <input type="checkbox" id="work-auth" name="work-auth" value="">
      </div>
    </div>`,
    `const group = document.querySelector(".ashby-application-form-input-yesno");
     const box = group.querySelector("input[type='checkbox']");
     const buttons = [...group.querySelectorAll("button")];
     for (const button of buttons) {
       button.addEventListener("click", () => {
         box.checked = true;
         box.value = button.textContent.trim();
         for (const other of buttons) { other.removeAttribute("aria-pressed"); }
       });
     }`,
  );

export interface PersonioPageOptions {
  confirmPill?: boolean;
  customResume?: boolean;
  decoy?: boolean;
  decoyPill?: boolean;
  language?: "de" | "en";
}

export const personioPage = (options: PersonioPageOptions = {}) => {
  const german = options.language === "de";

  const labels = {
    cover: german ? "Anschreiben" : "Cover letter",
    cv: german ? "Lebenslauf" : "Resume",
    email: german ? "E-Mail" : "Email",
    first: german ? "Vorname" : "First name",
    gender: german ? "Geschlecht" : "Gender",
    last: german ? "Nachname" : "Last name",
    other: german ? "Sonstiges" : "Other document",
    placeholder: german ? "Bitte auswählen" : "Please choose",
    question: german ? "Sprechen Sie Deutsch?" : "Do you speak German?",
    submit: german ? "Bewerbung senden" : "Submit application",
  };

  const decoy = options.decoy
    ? `<form action="/newsletter" method="post">
        <label for="newsletter-email">Email</label><input id="newsletter-email" name="email" type="email">
        <button type="submit">Subscribe</button>
      </form>`
    : "";

  const decoyPill = options.decoyPill
    ? `<ul><li role="listitem"><span>resume-board.pdf</span></li></ul>`
    : "";

  return `<!doctype html>
<html lang="${german ? "de" : "en"}">
<head><title>Senior Backend Engineer - Example</title></head>
<body data-job-id="123">
${decoy}
<form id="application" action="#" method="post">
  <label for="first_name">${labels.first}</label><input id="first_name" name="first_name" type="text" required>
  <label for="last_name">${labels.last}</label><input id="last_name" name="last_name" type="text" required>
  <label for="email">${labels.email}</label><input id="email" name="email" type="email" required>
  <label for="gender">${labels.gender}</label>
  <select id="gender" name="gender">
    <option value="" selected>${labels.placeholder}</option>
    <option value="female">${german ? "Weiblich" : "Female"}</option>
    <option value="male">${german ? "Männlich" : "Male"}</option>
  </select>
  <label for="custom_attribute_1001">${labels.question}</label>
  <select id="custom_attribute_1001" name="custom_attribute_1001">
    <option value="" selected>${labels.placeholder}</option>
    <option value="custom_option_2001">${german ? "Ja" : "Yes"}</option>
    <option value="custom_option_2002">${german ? "Nein" : "No"}</option>
  </select>
  <div role="group" aria-labelledby="doc-label-cv">
    <div id="doc-label-cv">${labels.cv}<span aria-hidden="true">*</span></div>
    <div class="document-input-wrapper"><input id="doc-cv" name="documents.cv" type="file"></div>
  </div>
  <div role="group" aria-labelledby="doc-label-cover">
    <div id="doc-label-cover">${labels.cover}</div>
    <div class="document-input-wrapper"><input id="doc-cover" name="documents.cover-letter" type="file"></div>
  </div>
  <div role="group" aria-labelledby="doc-label-other">
    <div id="doc-label-other">${labels.other}</div>
    <div class="document-input-wrapper"><input id="doc-other" name="documents.other" type="file"></div>
  </div>
  <div role="group" aria-labelledby="doc-label-custom">
    <div id="doc-label-custom">Resume</div>
    <div class="document-input-wrapper"><input id="doc-custom" name="custom_attribute_1009" type="file"></div>
  </div>
  <ul id="documents-list"></ul>
  <button type="submit">${labels.submit}</button>
</form>
${decoyPill}
<script>
  const form = document.querySelector("#application");
  const cv = document.querySelector("#doc-cv");
  ${
    options.confirmPill === true
      ? `cv.addEventListener("change", () => {
    const item = document.createElement("li");
    item.setAttribute("role", "listitem");
    const name = document.createElement("span");
    name.textContent = cv.files?.[0]?.name ?? "";
    item.append(name);
    document.querySelector("#documents-list").append(item);
  });`
      : ""
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = {};
    for (const control of form.querySelectorAll("input[name], select[name], textarea[name]")) {
      if (control instanceof HTMLInputElement && control.type === "file") {
        continue;
      }
      values[control.name] = control.value;
    }
    await fetch("/api/v1/jobs/123/application", {
      body: JSON.stringify(values),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    document.body.innerHTML = "<h2>Thank you for applying</h2><p>Your application has been received.</p>";
  });
</script>
${uploadListener()}
</body>
</html>`;
};

export const workablePage = (action: string) => `<!doctype html>
<html lang="en">
<head><title>Platform Engineer</title></head>
<body>
<form id="application-form" data-ui="application-form" method="post" action="${action}" enctype="multipart/form-data">
  <div class="form-field"><label for="other">Other documents</label><input id="other" name="other_documents" type="file"></div>
  <div class="form-field"><label for="cover">Cover letter</label><input id="cover" name="cover_letter" type="file"></div>
  <div class="form-field"><label for="email">Email</label><input id="email" name="email" type="email" required></div>
  <div class="form-field"><label for="resume">Resume</label><input id="resume" name="resume_file" type="file" required></div>
  <button type="submit">Submit application</button>
</form>
${uploadListener()}
</body>
</html>`;
