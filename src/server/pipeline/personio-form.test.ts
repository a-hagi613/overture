import { describe, expect, test } from "bun:test";

import { createPlainFormReader, isLoginWallRead } from "./form-read.ts";
import { personioApplyUrl, readPersonioFormHtml } from "./personio-form.ts";

const PAGE = `<!doctype html>
<html lang="de"><body>
<form>
  <div role="group" aria-labelledby="name-group-label">
    <span id="name-group-label">Name<span aria-hidden="true">*</span><span class="sr-only"> (erforderlich)</span></span>
    <label for="field-first_name">Vorname</label>
    <input id="field-first_name" type="text" name="first_name" />
    <label for="field-last_name">Nachname</label>
    <input id="field-last_name" type="text" name="last_name" />
  </div>
  <label for="field-email">E-Mail<span aria-hidden="true">*</span></label>
  <input id="field-email" type="email" name="email" />
  <label for="field-gender">Geschlecht</label>
  <select id="field-gender" name="gender">
    <option value="" selected>Bitte auswählen</option>
    <option value="female">Weiblich</option>
    <option value="male">Männlich</option>
  </select>
  <label for="field-custom_attribute_1001">Are you authorized to work in Germany?<span aria-hidden="true">*</span></label>
  <select id="field-custom_attribute_1001" name="custom_attribute_1001">
    <option value="" selected>Bitte auswählen</option>
    <option value="custom_option_2001">Yes</option>
    <option value="custom_option_2002">No</option>
  </select>
  <label for="field-custom_attribute_1002">Frühester Starttermin</label>
  <input id="field-custom_attribute_1002" type="date" name="custom_attribute_1002" />
  <div role="group" aria-labelledby="relocate-label">
    <div id="relocate-label">Are you authorized to work in Germany?<span aria-hidden="true">*</span></div>
    <label for="field-custom_attribute_2001_yes"><input id="field-custom_attribute_2001_yes" name="custom_attribute_2001" type="radio" value="yes" />Yes</label>
    <label for="field-custom_attribute_2001_no"><input id="field-custom_attribute_2001_no" name="custom_attribute_2001" type="radio" value="no" />No</label>
  </div>
  <div role="group" aria-labelledby="languages-label">
    <div id="languages-label">Which languages do you speak?</div>
    <label for="field-custom_attribute_2002_english"><input id="field-custom_attribute_2002_english" name="custom_attribute_2002" type="checkbox" value="english" />English</label>
    <label for="field-custom_attribute_2002_german"><input id="field-custom_attribute_2002_german" name="custom_attribute_2002" type="checkbox" value="german" />German</label>
  </div>
  <div role="group" aria-labelledby="doc-label-cv">
    <div id="doc-label-cv">Lebenslauf<span aria-hidden="true">*</span></div>
    <div class="document-input-wrapper">
      <button type="button">Datei hinzufügen</button>
      <input id="doc-input-cv" type="file" hidden name="documents.cv" />
    </div>
  </div>
  <div role="group" aria-labelledby="doc-label-cover-letter">
    <div id="doc-label-cover-letter">Anschreiben<span> (Optional)</span></div>
    <div class="document-input-wrapper">
      <input id="doc-input-cover-letter" type="file" hidden name="documents.cover-letter" />
    </div>
  </div>
  <input type="hidden" name="_token" value="hidden" />
  <button type="submit" disabled>Bewerbung senden</button>
</form>
</body></html>`;

describe("readPersonioFormHtml", () => {
  test("reads the standard fields, the employer's questions and the documents by their Personio names", async () => {
    const read = await readPersonioFormHtml(PAGE);

    expect(read.path).toBe("personio_html");
    expect(read.unhandled).toEqual([]);
    expect(read.questions.map((question) => question.fieldName)).toEqual([
      "first_name",
      "last_name",
      "email",
      "gender",
      "custom_attribute_1001",
      "custom_attribute_1002",
      "custom_attribute_2001",
      "custom_attribute_2002",
      "documents.cv",
      "documents.cover-letter",
    ]);

    const [
      first,
      ,
      email,
      gender,
      customSelect,
      customDate,
      customRadio,
      customChecks,
      resume,
      coverLetter,
    ] = read.questions;

    expect(first).toMatchObject({
      fieldName: "first_name",
      fieldType: "text",
      label: "First name",
      required: true,
    });
    expect(email).toMatchObject({ fieldType: "email", label: "Email", required: true });
    expect(gender).toMatchObject({
      fieldType: "select",
      label: "Gender",
      options: ["Weiblich", "Männlich"],
      required: false,
    });
    expect(customSelect).toMatchObject({
      fieldType: "select",
      label: "Are you authorized to work in Germany?",
      options: ["Yes", "No"],
      required: true,
    });
    expect(customDate).toMatchObject({
      fieldType: "date",
      label: "Frühester Starttermin",
      required: false,
    });
    expect(customRadio).toMatchObject({
      fieldType: "radio",
      label: "Are you authorized to work in Germany?",
      options: ["Yes", "No"],
      required: true,
    });
    expect(customChecks).toMatchObject({
      fieldType: "multiselect",
      label: "Which languages do you speak?",
      options: ["English", "German"],
      required: false,
    });
    expect(resume).toMatchObject({ fieldType: "file", label: "Resume", required: true });
    expect(coverLetter).toMatchObject({
      fieldType: "file",
      label: "Cover letter",
      required: false,
    });
  });

  test("normalises the star a required label carries and the language the page is in", async () => {
    const read = await readPersonioFormHtml(PAGE);
    const required = read.questions.filter((question) => question.required);

    expect(required.map((question) => question.fieldName)).toEqual([
      "first_name",
      "last_name",
      "email",
      "custom_attribute_1001",
      "custom_attribute_2001",
      "documents.cv",
    ]);
  });

  test("reports a control it cannot fill instead of dropping it silently", async () => {
    const read = await readPersonioFormHtml(
      PAGE.replace(
        '<input id="field-email" type="email" name="email" />',
        '<input id="field-email" type="email" name="email" /><input type="time" name="wake_time" />',
      ),
    );

    expect(read.unhandled).toEqual(["wake_time: time"]);
  });

  test("signs a form by its field names, so option text changes keep the same signature", async () => {
    const first = await readPersonioFormHtml(PAGE);
    const second = await readPersonioFormHtml(PAGE.replace("Weiblich", "Female"));

    expect(second.formSignature).toBe(first.formSignature);
    expect(second.questions[3]?.options).toEqual(["Female", "Männlich"]);
  });
});

describe("personioApplyUrl", () => {
  test("turns a posting URL into its apply page and keeps the language", () => {
    expect(personioApplyUrl("https://acme.jobs.personio.de/job/12345?language=de")).toBe(
      "https://acme.jobs.personio.de/job/12345/apply?language=de",
    );
    expect(personioApplyUrl("https://acme.jobs.personio.com/job/12345/apply")).toBe(
      "https://acme.jobs.personio.com/job/12345/apply",
    );
  });

  test("refuses a URL that is not a Personio posting", () => {
    expect(personioApplyUrl("https://acme.jobs.personio.de/about")).toBeNull();
  });
});

describe("the plain Personio form read", () => {
  test("fetches the apply page and parses it without a browser", async () => {
    const requested: string[] = [];

    const reader = createPlainFormReader({
      fetcher: async (input) => {
        const href = input instanceof Request ? input.url : input.toString();

        requested.push(href);

        return await Promise.resolve(new Response(PAGE, { status: 200 }));
      },
    });

    const read = await reader.read({
      applyUrl: "https://acme.jobs.personio.de/job/12345",
      ats: "personio",
      atsJobId: "12345",
      boardToken: "acme",
      region: "eu",
      url: "https://acme.jobs.personio.de/job/12345",
    });

    expect(requested).toEqual(["https://acme.jobs.personio.de/job/12345/apply"]);

    const form = isLoginWallRead(read) ? null : read;

    expect(form?.path).toBe("personio_html");
    expect(form?.questions.length).toBeGreaterThan(0);
  });
});
