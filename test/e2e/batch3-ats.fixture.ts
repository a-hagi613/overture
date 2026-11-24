import { z } from "zod";

export const BATCH3_CONFIRMATION_HTML = `<!doctype html>
<html lang="en"><body><h1>Thank you for applying</h1><p>Your application has been received.</p></body></html>`;

export type Batch3Board = "breezy" | "softgarden" | "clearcompany" | "join_com" | "pinpoint";

interface FixtureUpload {
  file: string;
  name: string;
}

interface ServedBatch3Page {
  url: string;
  posts: { fields: Record<string, string>; files: Record<string, string>; path: string }[];
  uploads: FixtureUpload[];
  close: () => void;
}

export interface Batch3PageOptions {
  /** A required control the approved plan never answered, to prove no answer is invented. */
  unexpectedRequired?: boolean;
  /** The confirmation page never appears, so the attempt must stay `unconfirmed`. */
  noConfirmation?: boolean;
  /** The board answers the submit with a 403 CAPTCHA page. */
  captcha?: boolean;
}

const RESUME_NAMES: Readonly<Record<Batch3Board, string>> = {
  breezy: "resume",
  clearcompany: "resumeFile",
  join_com: "resume",
  pinpoint: "application_form[application][cv]",
  softgarden: "resume",
};

const uploadListener = () => `<script>
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

export function startBatch3Page(html: string, options: Batch3PageOptions = {}) {
  const posts: ServedBatch3Page["posts"] = [];
  const uploads: FixtureUpload[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/__fixture__/uploaded" && request.method === "POST") {
        uploads.push(z.object({ file: z.string(), name: z.string() }).parse(await request.json()));

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
      }

      posts.push({ fields, files, path: url.pathname });

      if (options.captcha === true) {
        return new Response(
          `<!doctype html><html><body><h1>CAPTCHA required</h1><p>Please verify you are human.</p></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" }, status: 403 },
        );
      }

      return new Response(BATCH3_CONFIRMATION_HTML, {
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
  } satisfies ServedBatch3Page;
}

/**
 * The deterministic apply page for a Batch 3 board. It mirrors the markup contract
 * each adapter asserts: one application form root, named controls, a resume slot,
 * the employer's select question, and a decoy newsletter form that must never be
 * touched. The submit posts the real form and then either shows the employer's
 * confirmation or leaves the page without one.
 *
 * @param board the Wave 1A board whose form shape to serve
 * @param options the failure shape to exercise, when the test needs one
 * @returns the apply page HTML
 */
export function batch3Page(board: Batch3Board, options: Batch3PageOptions = {}) {
  const resumeName = RESUME_NAMES[board];

  const extraRequired =
    options.unexpectedRequired === true
      ? `<div class="form-field">
          <label for="security_clearance">Do you hold security clearance?</label>
          <input id="security_clearance" name="security_clearance" type="text" required>
        </div>`
      : "";

  const confirmationScript =
    options.noConfirmation === true
      ? `document.body.innerHTML = "<h1>Your details were saved.</h1>";`
      : `document.body.innerHTML = "<h1>Thank you for applying</h1><p>Your application has been received.</p>";`;

  return `<!doctype html>
<html lang="en">
<head><title>Senior Backend Engineer</title></head>
<body>
<form id="newsletter" action="/newsletter" method="post">
  <label for="newsletter_email">Email</label>
  <input id="newsletter_email" name="email" type="email" value="newsletter@example.com">
  <button type="submit">Subscribe</button>
</form>
<form id="application-form" class="application-form" data-board="${board}" method="post" action="/api/apply/${board}" enctype="multipart/form-data">
  <div class="form-field"><label for="first_name">First name</label><input id="first_name" name="first_name" type="text" required></div>
  <div class="form-field"><label for="last_name">Last name</label><input id="last_name" name="last_name" type="text" required></div>
  <div class="form-field"><label for="email">Email</label><input id="email" name="email" type="email" required></div>
  <div class="form-field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel"></div>
  <div class="form-field"><label for="work_auth">Are you legally authorized to work in Canada?</label>
    <select id="work_auth" name="work_auth" required>
      <option value="">Please choose</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  </div>
  <div class="form-field"><label for="resume">Resume</label><input id="resume" name="${resumeName}" type="file" required></div>
  <div class="form-field"><label for="privacy_consent">I agree to the privacy policy</label>
    <input id="privacy_consent" name="privacy_consent" type="checkbox" value="yes" required>
  </div>
  ${extraRequired}
  <button type="submit">Submit application</button>
</form>
${uploadListener()}
<script>
  const form = document.querySelector("#application-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const action = form.action;
    const body = new FormData(form);
    ${
      options.captcha === true
        ? 'document.body.innerHTML = "<h1>CAPTCHA required</h1><p>Please verify you are human.</p>";'
        : ""
    }
    const response = await fetch(action, { body, method: "POST" });
    if (!response.ok) {
      document.body.innerHTML = "<h1>CAPTCHA required</h1><p>Please verify you are human.</p>";
      return;
    }
    form.remove();
    ${confirmationScript}
  });
</script>
</body>
</html>`;
}
