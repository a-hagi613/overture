import { describe, expect, test } from "bun:test";

import { readBreezyFormHtml } from "./breezy-form.ts";
import { createPlainFormReader, isLoginWallRead } from "./form-read.ts";
import {
  breezyApplyUrl,
  CLEARCOMPANY_LABELS,
  joinComApplyUrl,
  pinpointApplyUrl,
  readClearCompanyFormHtml,
  readJoinComFormHtml,
  readPinpointFormHtml,
  readSoftgardenFormHtml,
  softgardenApplyUrl,
} from "./wave1a-forms.ts";

const PAGE = `<!doctype html>
<html lang="en"><body>
<form id="newsletter"><label for="newsletter_email">Email</label><input id="newsletter_email" name="email" type="email"><button type="submit">Subscribe</button></form>
<form id="application-form" class="application-form" enctype="multipart/form-data">
  <label for="first_name">First name<span aria-hidden="true">*</span></label>
  <input id="first_name" name="first_name" type="text" required>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <label for="work_auth">Are you legally authorized to work in Canada?</label>
  <select id="work_auth" name="work_auth" required>
    <option value="">Please choose</option>
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </select>
  <div role="group" aria-labelledby="relocate-label">
    <div id="relocate-label">Will you relocate?</div>
    <label for="relocate_yes"><input id="relocate_yes" name="relocate" type="radio" value="yes">Yes</label>
    <label for="relocate_no"><input id="relocate_no" name="relocate" type="radio" value="no">No</label>
  </div>
  <label for="resume">Resume</label>
  <input id="resume" name="resume" type="file" required>
  <input type="hidden" name="authenticity_token" value="hidden">
  <button type="submit">Submit application</button>
</form>
</body></html>`;

const BREEZY_PAGE = `<!doctype html><html><body>
<div id="react-root"></div>
<script id="portal-data" type="application/json">${JSON.stringify({
  data: {
    questions: [
      {
        questions: [
          {
            "\u005Fid": "8cb2cdf5b5e901",
            options: [{ text: "Yes" }, { text: "No" }],
            required: true,
            text: "Are you currently located in the Chicagoland area?",
            type: { id: "dropdown", name: "Dropdown List" },
          },
          {
            "\u005Fid": "b8c4719e8d1501",
            options: [{ text: "Yes" }, { text: "No" }],
            required: false,
            text: "Are you able to work from the office?",
            type: { id: "multiplechoice", name: "Multiple Choice" },
          },
          {
            "\u005Fid": "d0cd5b667ddc01",
            required: false,
            text: "Link to your website or portfolio",
            type: { id: "text", name: "Text" },
          },
          {
            "\u005Fid": "b7a1d5b1c20101",
            required: true,
            text: "Upload your portfolio",
            type: { id: "file", name: "File" },
          },
        ],
      },
    ],
  },
})}</script>
</body></html>`;

describe("the shared HTML form reader", () => {
  test("reads each Wave 1A board's controls with that board's path", async () => {
    const softgarden = await readSoftgardenFormHtml(PAGE);
    const clearcompany = await readClearCompanyFormHtml(PAGE);
    const join = await readJoinComFormHtml(PAGE);
    const pinpoint = await readPinpointFormHtml(PAGE);

    for (const [read, path] of [
      [softgarden, "softgarden_html"],
      [clearcompany, "clearcompany_html"],
      [join, "join_com_html"],
      [pinpoint, "pinpoint_html"],
    ] as const) {
      expect(read.path).toBe(path);
      expect(read.questions.map((question) => question.fieldName)).toEqual([
        "first_name",
        "email",
        "work_auth",
        "relocate",
        "resume",
      ]);
      expect(read.questions[0]).toMatchObject({ label: "First name", required: true });
      expect(read.questions[2]).toMatchObject({
        fieldType: "select",
        label: "Are you legally authorized to work in Canada?",
        options: ["Yes", "No"],
        required: true,
      });
      expect(read.questions[3]).toMatchObject({
        fieldType: "radio",
        label: "Will you relocate?",
        options: ["Yes", "No"],
      });
      expect(read.questions[4]).toMatchObject({ fieldType: "file", label: "Resume" });
    }
  });

  test("namespaces the signature by board so two boards never share a cached plan", async () => {
    const softgarden = await readSoftgardenFormHtml(PAGE);
    const pinpoint = await readPinpointFormHtml(PAGE);

    expect(pinpoint.formSignature).not.toBe(softgarden.formSignature);
  });

  test("maps a Pinpoint control name to its user-facing label", async () => {
    const read = await readPinpointFormHtml(
      PAGE.replace('name="first_name"', 'name="application_form[application][first_name]"').replace(
        'id="first_name"',
        'id="application_form_application_first_name"',
      ),
    );

    const first = read.questions.find(
      (question) => question.fieldName === "application_form[application][first_name]",
    );

    expect(first?.label).toBe("First name");
    expect(CLEARCOMPANY_LABELS.get("firstName")).toBe("First name");
  });

  test("reads a placeholder as the label when a board names its controls by placeholder", async () => {
    const read = await readJoinComFormHtml(
      PAGE.replace(
        '<label for="first_name">First name<span aria-hidden="true">*</span></label>\n  <input id="first_name" name="first_name" type="text" required>',
        '<input id="first_name" name="first_name" type="text" placeholder="First name" required>',
      ),
    );

    expect(read.questions.find((question) => question.fieldName === "first_name")?.label).toBe(
      "First name",
    );
  });
});

describe("the Breezy portal-data reader", () => {
  test("reads each questionnaire item with its type, options and required flag", () => {
    const read = readBreezyFormHtml(BREEZY_PAGE);

    expect(read?.path).toBe("breezy_json");
    expect(read?.questions).toEqual([
      {
        fieldName: "8cb2cdf5b5e901",
        fieldType: "select",
        label: "Are you currently located in the Chicagoland area?",
        options: ["Yes", "No"],
        required: true,
      },
      {
        fieldName: "b8c4719e8d1501",
        fieldType: "radio",
        label: "Are you able to work from the office?",
        options: ["Yes", "No"],
        required: false,
      },
      {
        fieldName: "d0cd5b667ddc01",
        fieldType: "text",
        label: "Link to your website or portfolio",
        options: [],
        required: false,
      },
      {
        fieldName: "b7a1d5b1c20101",
        fieldType: "file",
        label: "Upload your portfolio",
        options: [],
        required: true,
      },
    ]);
  });

  test("returns null when the page has no readable payload, so callers fall back", () => {
    expect(readBreezyFormHtml("<html><body>not a Breezy page</body></html>")).toBeNull();
    expect(readBreezyFormHtml('<script id="portal-data">not json</script>')).toBeNull();
  });
});

describe("Wave 1A apply URLs", () => {
  test("turns each posting URL into its apply URL", () => {
    expect(breezyApplyUrl("https://acme.breezy.hr/p/123-role")).toBe(
      "https://acme.breezy.hr/p/123-role/apply",
    );
    expect(softgardenApplyUrl("https://acme.softgarden.io/job/456?l=en")).toBe(
      "https://acme.softgarden.io/job/456/apply?l=en",
    );
    expect(joinComApplyUrl("https://join.com/companies/acme/789-role")).toBe(
      "https://join.com/companies/acme/789-role/apply",
    );
    expect(pinpointApplyUrl("https://acme.pinpointhq.com/en/postings/abc-123")).toBe(
      "https://acme.pinpointhq.com/en/postings/abc-123/applications/new",
    );
  });

  test("refuses a URL that is not that board's posting", () => {
    expect(breezyApplyUrl("https://acme.breezy.hr/about")).toBeNull();
    expect(softgardenApplyUrl("https://acme.softgarden.io/about")).toBeNull();
    expect(joinComApplyUrl("https://join.com/about")).toBeNull();
    expect(pinpointApplyUrl("https://acme.pinpointhq.com/about")).toBeNull();
  });
});

describe("the plain Wave 1A form read", () => {
  test("fetches each board's apply page and parses it without a browser", async () => {
    const requested: string[] = [];

    const fetcher = async (input: RequestInfo | URL) => {
      const href = input instanceof Request ? input.url : input.toString();

      requested.push(href);

      return await Promise.resolve(
        new Response(href.includes("breezy") ? BREEZY_PAGE : PAGE, { status: 200 }),
      );
    };

    const reader = createPlainFormReader({ fetcher });

    const cases = [
      {
        ats: "breezy" as const,
        url: "https://acme.breezy.hr/p/123-role",
        path: "breezy_json",
      },
      {
        ats: "softgarden" as const,
        url: "https://acme.softgarden.io/job/456",
        path: "softgarden_html",
      },
      {
        ats: "clearcompany" as const,
        url: "https://apply.clearcompany.com/acme/789",
        path: "clearcompany_html",
      },
      {
        ats: "join_com" as const,
        url: "https://join.com/companies/acme/101-role",
        path: "join_com_html",
      },
      {
        ats: "pinpoint" as const,
        url: "https://acme.pinpointhq.com/postings/abc-123",
        path: "pinpoint_html",
      },
    ] as const;

    const reads = await Promise.all(
      cases.map(async (entry) => {
        const read = await reader.read({
          applyUrl: entry.url,
          ats: entry.ats,
          atsJobId: "123",
          boardToken: "acme",
          region: "us",
          url: entry.url,
        });

        return { form: isLoginWallRead(read) ? null : read, path: entry.path };
      }),
    );

    for (const { form, path } of reads) {
      expect(form?.path).toBe(path);
      expect(form?.questions.length).toBeGreaterThan(0);
    }

    expect(requested).toEqual([
      "https://acme.breezy.hr/p/123-role/apply",
      "https://acme.softgarden.io/job/456/apply",
      "https://apply.clearcompany.com/acme/789",
      "https://join.com/companies/acme/101-role/apply",
      "https://acme.pinpointhq.com/postings/abc-123/applications/new",
    ]);
  });
});
