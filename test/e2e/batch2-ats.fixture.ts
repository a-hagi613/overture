import { CONFIRMATION_HTML } from "./ats-quirks.fixture.ts";

export type Batch2Board = "teamtailor" | "zoho_recruit" | "bamboohr" | "recruitee" | "hireology";

export interface BoardFormOptions {
  extraRequired?: boolean;
  withoutOption?: boolean;
}

export const BATCH2_PATHS = {
  teamtailor: { action: "/example/jobs/1/applications", posting: "/example/jobs/1" },
  zoho_recruit: {
    action: "/example/jobs/Careers/1/apply",
    posting: "/example/jobs/Careers/1",
  },
  bamboohr: { action: "/example/careers/1/apply", posting: "/example/careers/1" },
  recruitee: {
    action: "/example/o/platform-engineer/c/new",
    posting: "/example/o/platform-engineer",
  },
  hireology: { action: "/example/jobs/1/applications", posting: "/example/jobs/1" },
} as const;

export const BATCH2_FORM_SELECTORS = {
  teamtailor: "#new_candidate",
  zoho_recruit: "#application_form",
  bamboohr: "#applicationForm",
  recruitee: "#new_candidate",
  hireology: "#application-form",
} as const satisfies Record<Batch2Board, string>;

export const BATCH2_JOB_IDS = {
  teamtailor: "1",
  zoho_recruit: "1",
  bamboohr: "1",
  recruitee: "platform-engineer",
  hireology: "1",
} as const satisfies Record<Batch2Board, string>;

export const BATCH2_RESUME_NAMES = {
  teamtailor: "candidate[resume]",
  zoho_recruit: "resume",
  bamboohr: "resume",
  recruitee: "candidate[cv]",
  hireology: "resume",
} as const satisfies Record<Batch2Board, string>;

const star = `<span aria-hidden="true">*</span>`;

const extraQuestion = (options: BoardFormOptions) =>
  options.extraRequired === true
    ? `<label for="extra">Current employer${star}</label>
  <input id="extra" name="extra_answer" required>`
    : "";

const workSelect = (options: BoardFormOptions) => `<label for="work">Authorized to work?</label>
  <select id="work" name="question_1" required>
    <option value="">Select an answer</option>
    <option value="Yes">Yes</option>
    ${options.withoutOption === true ? "" : `<option value="No">No</option>`}
  </select>`;

const form = (board: Batch2Board, body: string) =>
  `<form id="${BATCH2_FORM_SELECTORS[board].slice(1)}" method="post" action="${BATCH2_PATHS[board].action}" enctype="multipart/form-data">
${body}
  <button type="submit">Submit application</button>
</form>`;

const BUILDERS = {
  teamtailor: (options: BoardFormOptions) =>
    form(
      "teamtailor",
      `<label for="tt-first">First name${star}</label><input id="tt-first" name="candidate[first_name]" required>
  <label for="tt-last">Last name${star}</label><input id="tt-last" name="candidate[last_name]" required>
  <label for="tt-email">Email${star}</label><input id="tt-email" name="candidate[email]" type="email" required>
  <label for="tt-phone">Phone</label><input id="tt-phone" name="candidate[phone]" type="tel">
  ${workSelect(options)}
  <label for="tt-resume">Resume/CV${star}</label><input id="tt-resume" name="candidate[resume]" type="file" required>
  <label for="tt-consent"><input id="tt-consent" name="candidate[consent]" type="checkbox" value="yes" required> I agree to the privacy policy</label>
  ${extraQuestion(options)}`,
    ),
  zoho_recruit: (options: BoardFormOptions) =>
    form(
      "zoho_recruit",
      `<label for="z-first">First name${star}</label><input id="z-first" name="first_name" required>
  <label for="z-last">Last name${star}</label><input id="z-last" name="last_name" required>
  <label for="z-email">Email${star}</label><input id="z-email" name="email" type="email" required>
  <label for="z-phone">Phone</label><input id="z-phone" name="phone" type="tel">
  <fieldset><legend>Authorized to work?</legend>
    <label><input name="authorized" type="radio" value="Yes" required> Yes</label>
    <label><input name="authorized" type="radio" value="No"> No</label>
  </fieldset>
  <label for="z-resume">Resume</label><input id="z-resume" name="resume" type="file" required>
  ${extraQuestion(options)}`,
    ),
  bamboohr: (options: BoardFormOptions) =>
    form(
      "bamboohr",
      `<label for="b-first">First name${star}</label><input id="b-first" name="firstName" required>
  <label for="b-last">Last name${star}</label><input id="b-last" name="lastName" required>
  <label for="b-email">Email${star}</label><input id="b-email" name="email" type="email" required>
  <label for="b-phone">Phone</label><input id="b-phone" name="phoneNumber" type="tel">
  ${workSelect(options)}
  <label for="b-resume">Resume</label><input id="b-resume" name="resume" type="file" required>
  ${extraQuestion(options)}`,
    ),
  recruitee: (options: BoardFormOptions) =>
    form(
      "recruitee",
      `<label for="r-name">Full name${star}</label><input id="r-name" name="candidate[name]" required>
  <label for="r-email">Email${star}</label><input id="r-email" name="candidate[email]" type="email" required>
  <fieldset><legend>Work arrangement</legend>
    <label><input name="candidate[arrangement]" type="checkbox" value="Remote"> Remote</label>
    <label><input name="candidate[arrangement]" type="checkbox" value="Hybrid"> Hybrid</label>
  </fieldset>
  <label for="r-note">Why do you want this role?${star}</label><textarea id="r-note" name="candidate[question_1]" required></textarea>
  <label for="r-cv">CV${star}</label><input id="r-cv" name="candidate[cv]" type="file" required>
  ${extraQuestion(options)}`,
    ),
  hireology: (options: BoardFormOptions) =>
    form(
      "hireology",
      `<label for="h-first">First name${star}</label><input id="h-first" name="first_name" required>
  <label for="h-last">Last name${star}</label><input id="h-last" name="last_name" required>
  <label for="h-email">Email${star}</label><input id="h-email" name="email" type="email" required>
  ${workSelect(options)}
  <label for="h-resume">Resume${star}</label><input id="h-resume" name="resume" type="file" required>
  ${extraQuestion(options)}`,
    ),
} as const satisfies Record<Batch2Board, (options: BoardFormOptions) => string>;

export function batch2Page(board: Batch2Board, options: BoardFormOptions = {}) {
  return `<!doctype html>
<html lang="en"><head><title>Platform Engineer</title></head><body>
<form action="/newsletter"><label for="news">Newsletter</label><input id="news" name="news" type="email"></form>
${BUILDERS[board](options)}
<script>
  const form = document.querySelector(${JSON.stringify(BATCH2_FORM_SELECTORS[board])});
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch(form.action, { body: new FormData(form), method: "POST" });
    const text = await response.text();
    document.body.innerHTML = response.ok ? text : "<h2>Something went wrong</h2>";
  });
</script>
</body></html>`;
}

export interface Batch2Server {
  url: string;
  posts: { fields: Record<string, string>; files: Record<string, string>; path: string }[];
  close: () => void;
}

export function startBatch2Page(
  html: string,
  options: { confirmation?: string; status?: number } = {},
) {
  const posts: Batch2Server["posts"] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method !== "POST") {
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      const fields: Record<string, string> = {};
      const files: Record<string, string> = {};

      for (const [name, value] of await request.formData()) {
        if (value instanceof File) {
          files[name] = value.name;
        } else {
          fields[name] = value;
        }
      }

      posts.push({ fields, files, path: url.pathname });

      return new Response(options.confirmation ?? CONFIRMATION_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: options.status ?? 200,
      });
    },
  });

  return {
    url: server.url.toString().replace(/\/$/u, ""),
    posts,
    close: () => {
      void server.stop(true);
    },
  } satisfies Batch2Server;
}
