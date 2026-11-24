import { describe, expect, test } from "bun:test";

import { readBatch4FormHtml } from "./batch4-forms.ts";

const PAGE = `<!doctype html>
<html lang="en"><body>
<form class="application-form" id="hiringthing-apply">
  <div class="form-field" data-field="first_name">
    <label for="first_name">First name <span>*</span></label>
    <input id="first_name" name="first_name" type="text" required>
  </div>
  <div class="form-field" data-field="email">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required>
  </div>
  <div class="form-field" data-field="resume">
    <label for="resume">Resume</label>
    <input id="resume" name="resume" type="file" required>
  </div>
  <fieldset class="form-field" data-field="sponsorship_required">
    <legend>Will you now, or in the future, require visa sponsorship? <span>*</span></legend>
    <input id="sponsorship_required_0" type="radio" name="sponsorship_required" value="Yes" required>
    <label for="sponsorship_required_0">Yes</label>
    <input id="sponsorship_required_1" type="radio" name="sponsorship_required" value="No" required>
    <label for="sponsorship_required_1">No</label>
  </fieldset>
  <div class="form-field" data-field="privacy_consent">
    <label for="privacy_consent">I agree to the privacy notice.</label>
    <input id="privacy_consent" name="privacy_consent" type="checkbox" value="Yes" required>
  </div>
  <input type="hidden" name="csrf_token" value="secret">
  <button type="submit">Submit application</button>
</form>
</body></html>`;

describe("the Batch 4 form reader", () => {
  test("reads every labelled control of the one application form", async () => {
    const read = await readBatch4FormHtml(PAGE);

    expect(read.questions).toEqual([
      {
        fieldName: "first_name",
        fieldType: "text",
        label: "First name",
        options: [],
        required: true,
      },
      { fieldName: "email", fieldType: "email", label: "Email", options: [], required: true },
      { fieldName: "resume", fieldType: "file", label: "Resume", options: [], required: true },
      {
        fieldName: "sponsorship_required",
        fieldType: "radio",
        label: "Will you now, or in the future, require visa sponsorship?",
        options: ["Yes", "No"],
        required: true,
      },
      {
        fieldName: "privacy_consent",
        fieldType: "checkbox",
        label: "I agree to the privacy notice.",
        options: [],
        required: true,
      },
    ]);
    expect(read.unhandled).toEqual([]);
  });

  test("keeps the same signature when only copy changes", async () => {
    const first = await readBatch4FormHtml(PAGE);
    const second = await readBatch4FormHtml(PAGE.replace("First name", "Given name"));

    expect(second.formSignature).toBe(first.formSignature);
    expect(first.path).toBe("batch4_html");
  });

  test("fails closed on a page with no form", async () => {
    const read = await readBatch4FormHtml("<html><body><p>No form here.</p></body></html>");

    expect(read.questions).toEqual([]);
    expect(read.formSignature).toBe("");
  });

  test("reports a control it cannot fill instead of guessing", async () => {
    const read = await readBatch4FormHtml(PAGE.replace('type="email"', 'type="password"'));

    expect(read.unhandled).toEqual(["email: password"]);
    expect(read.questions.map((question) => question.fieldName)).not.toContain("email");
  });
});
