import { describe, expect, test } from "bun:test";

import { readBreezyFormHtml } from "./breezy-form.ts";
import { createPlainFormReader, isLoginWallRead } from "./form-read.ts";
import {
  breezyApplyUrl,
  CLEARCOMPANY_LABELS,
  joinComApplyUrl,
  pinpointApplyUrl,
  readBambooHRFormHtml,
  readClearCompanyFormHtml,
  readHireologyFormHtml,
  readJoinComFormHtml,
  readPinpointFormHtml,
  readRecruiteeFormHtml,
  readSoftgardenFormHtml,
  readTeamtailorFormHtml,
  readZohoRecruitFormHtml,
  recruiteeApplyUrl,
  softgardenApplyUrl,
  teamtailorApplyUrl,
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

const TEAMTAILOR_PAGE = `<!doctype html><html><body>
<form id="newsletter"><label for="news">Email</label><input id="news" name="news" type="email"></form>
<form id="new_candidate" enctype="multipart/form-data">
  <label for="first">First name<span aria-hidden="true">*</span></label>
  <input id="first" name="candidate[first_name]" required>
  <label for="email">Email</label><input id="email" name="candidate[email]" type="email" required>
  <label for="resume">Resume/CV</label><input id="resume" name="candidate[resume]" type="file" required>
  <label for="work">Authorized to work?</label>
  <select id="work" name="candidate[question_1]" required>
    <option value="">Select</option><option value="yes">Yes</option><option value="no">No</option>
  </select>
  <label for="consent"><input id="consent" name="candidate[consent]" type="checkbox" required> I agree</label>
  <button type="submit">Submit application</button>
</form></body></html>`;

const ZOHO_PAGE = `<!doctype html><html><body>
<form id="application_form">
  <label for="first">First name</label><input id="first" name="first_name" required>
  <fieldset><legend>Authorized to work?</legend>
    <label><input name="authorized" type="radio" value="yes" required> Yes</label>
    <label><input name="authorized" type="radio" value="no"> No</label>
  </fieldset>
  <label for="resume">Resume</label><input id="resume" name="resume" type="file">
  <textarea name="note" aria-label="Additional information"></textarea>
  <button type="submit">Apply</button>
</form></body></html>`;

const BAMBOO_PAGE = `<!doctype html><html><body>
<form id="applicationForm">
  <label for="first">First name</label><input id="first" name="firstName" required>
  <label for="phone">Phone</label><input id="phone" name="phoneNumber" type="tel">
  <label for="resume">Resume</label><input id="resume" name="resume" type="file">
  <button type="submit">Submit</button>
</form></body></html>`;

const RECRUITEE_PAGE = `<!doctype html><html><body>
<form id="new_candidate">
  <label for="name">Full name</label><input id="name" name="candidate[name]" required>
  <fieldset><legend>Work arrangement</legend>
    <label><input name="candidate[arrangement]" type="checkbox" value="remote"> Remote</label>
    <label><input name="candidate[arrangement]" type="checkbox" value="hybrid"> Hybrid</label>
  </fieldset>
  <label for="cv">CV</label><input id="cv" name="candidate[cv]" type="file">
  <button type="submit">Send</button>
</form></body></html>`;

const HIREOLOGY_PAGE = `<!doctype html><html><body>
<form id="application-form">
  <input type="hidden" name="authenticity_token" value="secret">
  <label for="first">First name</label><input id="first" name="first_name" required>
  <label for="resume">Resume</label><input id="resume" name="resume" type="file">
  <label><input name="consent" type="checkbox" required> I agree</label>
  <button type="submit">Apply now</button>
</form></body></html>`;

const BATCH2_PAGES = {
  teamtailor: TEAMTAILOR_PAGE,
  zoho_recruit: ZOHO_PAGE,
  bamboohr: BAMBOO_PAGE,
  recruitee: RECRUITEE_PAGE,
  hireology: HIREOLOGY_PAGE,
} as const;

describe("the Batch 2 form readers", () => {
  test("reads Teamtailor's candidate fields, resume and question", async () => {
    const read = await readTeamtailorFormHtml(TEAMTAILOR_PAGE);

    expect(read.path).toBe("teamtailor_html");
    expect(read.questions.map((question) => question.fieldName)).toEqual([
      "candidate[first_name]",
      "candidate[email]",
      "candidate[resume]",
      "candidate[question_1]",
      "candidate[consent]",
    ]);
    expect(read.questions[0]?.label).toBe("First name");
    expect(read.questions[3]?.fieldType).toBe("select");
    expect(read.questions[3]?.options).toEqual(["Yes", "No"]);
  });

  test("reads Zoho Recruit's radio group and textarea", async () => {
    const read = await readZohoRecruitFormHtml(ZOHO_PAGE);
    const radio = read.questions.find((question) => question.fieldName === "authorized");

    expect(read.path).toBe("zoho_recruit_html");
    expect(radio?.fieldType).toBe("radio");
    expect(radio?.label).toBe("Authorized to work?");
    expect(radio?.options).toEqual(["Yes", "No"]);
    expect(read.questions.find((question) => question.fieldName === "note")?.fieldType).toBe(
      "textarea",
    );
  });

  test("reads BambooHR's camel-case names and phone type", async () => {
    const read = await readBambooHRFormHtml(BAMBOO_PAGE);

    expect(read.path).toBe("bamboohr_html");
    expect(read.questions.map((question) => question.label)).toEqual([
      "First name",
      "Phone",
      "Resume",
    ]);
    expect(read.questions[1]?.fieldType).toBe("phone");
  });

  test("reads Recruitee's candidate names and multiselect", async () => {
    const read = await readRecruiteeFormHtml(RECRUITEE_PAGE);

    expect(read.path).toBe("recruitee_html");
    expect(
      read.questions.find((question) => question.fieldName === "candidate[arrangement]"),
    ).toMatchObject({
      fieldType: "multiselect",
      options: ["Remote", "Hybrid"],
    });
  });

  test("reads Hireology's fields and skips its token", async () => {
    const read = await readHireologyFormHtml(HIREOLOGY_PAGE);

    expect(read.path).toBe("hireology_html");
    expect(read.questions.map((question) => question.fieldName)).toEqual([
      "first_name",
      "resume",
      "consent",
    ]);
    expect(read.questions[2]?.fieldType).toBe("checkbox");
  });
});

describe("Batch 2 apply URLs", () => {
  test("opens Teamtailor's applications/new page", () => {
    expect(teamtailorApplyUrl("https://acme.teamtailor.com/jobs/1")).toBe(
      "https://acme.teamtailor.com/jobs/1/applications/new",
    );
  });

  test("opens Recruitee's c/new page", () => {
    expect(recruiteeApplyUrl("https://acme.recruitee.com/o/platform-engineer")).toBe(
      "https://acme.recruitee.com/o/platform-engineer/c/new",
    );
  });

  test("leaves a URL that is not that board's posting alone", () => {
    expect(teamtailorApplyUrl("https://acme.teamtailor.com/about")).toBeNull();
    expect(recruiteeApplyUrl("https://acme.recruitee.com/about")).toBeNull();
  });
});

describe("the plain Batch 2 form read", () => {
  test("fetches each board's apply page and parses it without a browser", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const href = input instanceof Request ? input.url : input.toString();
      const host = new URL(href).host;

      const board = (Object.keys(BATCH2_PAGES) as (keyof typeof BATCH2_PAGES)[]).find((name) =>
        host.includes(name.replace("_recruit", "")),
      );

      return await Promise.resolve(
        new Response(BATCH2_PAGES[board ?? "teamtailor"], { status: 200 }),
      );
    };

    const reader = createPlainFormReader({ fetcher });

    const cases = [
      { ats: "teamtailor" as const, url: "https://acme.teamtailor.com/jobs/1" },
      { ats: "zoho_recruit" as const, url: "https://acme.zohorecruit.com/jobs/Careers/1" },
      { ats: "bamboohr" as const, url: "https://acme.bamboohr.com/careers/1" },
      { ats: "recruitee" as const, url: "https://acme.recruitee.com/o/platform-engineer" },
      { ats: "hireology" as const, url: "https://acme.hireology.com/jobs/1" },
    ] as const;

    const reads = await Promise.all(
      cases.map(async (entry) => {
        const read = await reader.read({
          applyUrl: null,
          ats: entry.ats,
          atsJobId: "1",
          boardToken: "acme",
          region: "us",
          url: entry.url,
        });

        return isLoginWallRead(read) ? null : read;
      }),
    );

    expect(reads.map((read) => read?.path)).toEqual([
      "teamtailor_html",
      "zoho_recruit_html",
      "bamboohr_html",
      "recruitee_html",
      "hireology_html",
    ]);

    for (const read of reads) {
      expect(read?.questions.length).toBeGreaterThan(0);
    }
  });
});
