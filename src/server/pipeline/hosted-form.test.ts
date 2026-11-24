import { describe, expect, test } from "bun:test";

import { BATCH_1_ATS } from "../../shared/ats.ts";
import { detectLoginWall } from "./login-wall.ts";
import {
  formSignatureForHostedQuestions,
  HOSTED_FORM_PATHS,
  readHostedFormHtml,
} from "./hosted-form.ts";

const applicationForm = (id: string) => `<!doctype html>
<html lang="en"><body>
<form id="newsletter" method="post" action="/newsletter">
  <label for="newsletter-email">Email</label>
  <input id="newsletter-email" name="email" type="email">
  <button type="submit">Subscribe</button>
</form>
<form id="${id}" method="post" action="/apply" enctype="multipart/form-data">
  <label for="first_name">First name</label>
  <input id="first_name" name="first_name" type="text" required>
  <label for="last_name">Last name</label>
  <input id="last_name" name="last_name" type="text" required>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <label for="linkedin">LinkedIn</label>
  <input id="linkedin" name="linkedin" type="url">
  <fieldset>
    <legend>Are you authorised to work in Canada?</legend>
    <label><input name="work_auth" type="radio" value="yes" required>Yes</label>
    <label><input name="work_auth" type="radio" value="no">No</label>
  </fieldset>
  <label for="pronouns">Pronouns</label>
  <select id="pronouns" name="pronouns">
    <option value="">Please choose</option>
    <option value="she">She/her</option>
    <option value="they">They/them</option>
  </select>
  <label for="resume">Resume</label>
  <input id="resume" name="resume" type="file" required>
  <input type="hidden" name="csrf" value="token">
  <button type="submit">Submit application</button>
</form>
</body></html>`;

const LOGIN_GATE = `<!doctype html>
<html lang="en">
<head><title>Sign in | Example</title></head>
<body>
<h1>Sign in</h1>
<p>You must sign in to continue.</p>
<form id="sign-in" method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email" required>
  <label for="password">Password</label><input id="password" name="password" type="password" required>
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const FORM_IDS = {
  careerplug: "new_application",
  jazzhr: "application-form",
  manatal: "application-form",
  paylocity: "applicationForm",
  smartrecruiters: "application-form",
} as const;

describe("the Batch 1 hosted form reader", () => {
  test("reads the application form, never the newsletter decoy", async () => {
    const reads = await Promise.all(
      BATCH_1_ATS.map(async (ats) => ({
        ats,
        read: await readHostedFormHtml(ats, applicationForm(FORM_IDS[ats])),
      })),
    );

    for (const { read } of reads) {
      expect(read.questions.map((question) => question.fieldName)).toEqual([
        "first_name",
        "last_name",
        "email",
        "linkedin",
        "work_auth",
        "pronouns",
        "resume",
      ]);
      expect(read.questions.find((question) => question.fieldName === "work_auth")).toMatchObject({
        fieldType: "radio",
        label: "Are you authorised to work in Canada?",
        options: ["Yes", "No"],
        required: true,
      });
      expect(read.questions.find((question) => question.fieldName === "resume")).toMatchObject({
        fieldType: "file",
        label: "Resume",
        required: true,
      });
      expect(read.unhandled).toEqual([]);
    }
  });

  test("records the board's own read path and a stable field signature", async () => {
    const first = await readHostedFormHtml("paylocity", applicationForm("applicationForm"));
    const second = await readHostedFormHtml("paylocity", applicationForm("applicationForm"));

    expect(first.path).toBe("paylocity_html");
    expect(first.formSignature).toBe(second.formSignature);
    expect(first.formSignature).toBe(formSignatureForHostedQuestions("paylocity", first.questions));
    expect(HOSTED_FORM_PATHS).toContain(first.path);
  });

  test("reads the only form on a page with no decoy", async () => {
    const read = await readHostedFormHtml(
      "jazzhr",
      `<html lang="en"><body><form id="newsletter"><label for="e">Email</label><input id="e" name="email" type="email"></form></body></html>`,
    );

    expect(read.questions.map((question) => question.fieldName)).toEqual(["email"]);
    expect(read.path).toBe("jazzhr_html");
  });

  test("a password control is reported, never read as a fillable answer", async () => {
    const read = await readHostedFormHtml(
      "smartrecruiters",
      `<html lang="en"><body><form id="application-form">
        <label for="email">Email</label><input id="email" name="email" type="email">
        <label for="password">Password</label><input id="password" name="password" type="password">
        <button type="submit">Submit</button>
      </form></body></html>`,
    );

    expect(read.unhandled).toContain("password: password");
    expect(read.questions.map((question) => question.fieldName)).toEqual(["email"]);
  });
});

describe("the Paylocity login gate", () => {
  test("is a wall before the form, with the sign-in evidence recorded", () => {
    const verdict = detectLoginWall({
      html: LOGIN_GATE,
      requestedUrl: "https://example.test/apply",
    });

    expect(verdict.wall).toBe(true);

    if (!verdict.wall) {
      throw new Error("the login gate was not detected");
    }

    expect(verdict.evidence.markers).toContain("sign_in_copy");
    expect(verdict.evidence.markers).toContain("password_field");
    expect(verdict.evidence.markers).toContain("sign_in_form");
  });
});
