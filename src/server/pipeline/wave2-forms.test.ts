import { describe, expect, test } from "bun:test";

import { readHerpFormHtml, readJobviteFormHtml } from "./wave2-forms.ts";

const JOBVITE_PAGE = `<!doctype html>
<html><body>
<form name="consentForm" class="jv-form" method="POST" action="/acme/job/JV-1001/apply">
  <select id="jv-country-select"><option value="">Select</option><option value="all">All Countries</option></select>
</form>
<script>
  angular.module('preloadedData', []).constant('preloadedData', {
    applyFields: [
      {"fieldType":"Name","name":"First Name","required":true,"fieldId":-1,"viewFieldEId":"yNPjYfwD"},
      {"fieldType":"Name","name":"Last Name","required":true,"fieldId":-2,"viewFieldEId":"yPPjYfwF"},
      {"fieldType":"Email","name":"Email Address","required":true,"fieldId":-3,"viewFieldEId":"yOPjYfwE"},
      {"fieldType":"Phone","name":"Phone","required":false,"fieldId":-8,"viewFieldEId":"ySPjYfwI"},
      {"fieldType":"DropDown","name":"Country","required":true,"fieldId":-7,"viewFieldEId":"yV0qYfw3","values":[{"key":"United States","value":"United States"},{"key":"Canada","value":"Canada"}]},
      {"fieldType":"Radio","name":"Are you authorised to work here?","required":true,"fieldId":148281,"viewFieldEId":"yQ4kYfwW","values":[{"key":"No","value":"No"},{"key":"Yes","value":"Yes"}]},
      {"fieldType":"CheckBox","name":"Which languages do you speak?","required":false,"fieldId":148282,"viewFieldEId":"yZ9kYfwL","values":[{"key":"English","value":"English"},{"key":"French","value":"French"}]},
      {"fieldType":"TextArea","name":"Anything else we should know? [optional]","required":false,"fieldId":148283,"viewFieldEId":"yA1kYfwM"}
    ],
    preScreeningFormFields: {"name":"EU General","section":[{"element":[
      {"elementNo":"0","required":false,"fields":[{"fieldId":"f0","fieldType":"Radio","name":"Are you willing to complete a background check?","required":true,"values":[{"key":"Yes","value":"Yes"},{"key":"No","value":"No"}]}]},
      {"elementNo":"1","required":false,"fields":[{"fieldId":"f1","fieldType":"Name","name":"University Attended","required":false}]},
      {"elementNo":"2","required":false,"fields":[{"fieldId":"f3","fieldType":"CheckBox","name":"Which languages do you speak?","required":true,"values":[{"key":"English","value":"English"},{"key":"Spanish","value":"Spanish"}]}]},
      {"elementNo":"3","required":false,"fields":[{"fieldId":"f7","fieldType":"DropDown","name":"Currency","required":true,"values":[{"key":"EUR","value":"EUR"},{"key":"GBP","value":"GBP"}]}]},
      {"elementNo":"4","required":false,"fields":[{"fieldId":"date8","fieldType":"Date","name":"Earliest start date","required":true}]}
    ]}]}
  });
</script>
</body></html>`;

const HERP_PAGE = `<!doctype html>
<html lang="en"><body>
<main><script id="herp-react-props" type="application/json">{
  "companySlug":"acme","careerPageId":"HP-1001","applyFormPage":true,
  "applyForm":{"id":"f7df9e42","telephoneNumber":"visible","currentCompany":"visible","age":"invisible","education":"visible","career":"visible","messageToCompany":"visible","links":"invisible","resume":"visible","careerSummaries":"visible","otherFile":"visible","dateOfBirth":"invisible","namePronunciation":"invisible","currentAnnualSalary":"visible","minDesiredSalary":"invisible","desiredSalary":"invisible","additionalRequirements":"invisible"},
  "i18n":{"default":{
    "name":{"label":"Name","ariaLabel":"Name"},
    "email":{"label":"Email","ariaLabel":"Email"},
    "phone":{"label":"Phone","ariaLabel":"Phone"},
    "currentCompany":{"label":"Current company","ariaLabel":"Current company"},
    "education":{"label":"Education","ariaLabel":"Education"},
    "workExpirences":{"label":"Work Experience","ariaLabel":"Work Experience"},
    "currentAnnualSalary":{"label":"Current annual salary (10k JPY)","ariaLabel":"Current annual salary in units of 10,000 JPY"},
    "message":{"label":"Message to us","ariaLabel":"Message to us"},
    "resume":{"label":"Resume","ariaLabel":"Upload resume"},
    "cv":{"label":"CV","ariaLabel":"Upload CV"},
    "otherFiles":{"label":"Other related files","ariaLabel":"Upload other related files"},
    "privacyPolicy":{"ariaLabel":"Agree to the Privacy Policy"}
  }}
}</script></main>
</body></html>`;

describe("readJobviteFormHtml", () => {
  test("reads the main fields and the next step's pre-screening questions", () => {
    const read = readJobviteFormHtml(JOBVITE_PAGE);

    expect(read.path).toBe("jobvite_html");
    expect(read.formSignature).toMatch(/^[0-9a-f]{16}$/u);
    expect(read.unhandled).toEqual([]);

    const byLabel = new Map(read.questions.map((question) => [question.label, question]));

    expect(byLabel.get("First Name")).toMatchObject({
      fieldName: "input-yNPjYfwD",
      fieldType: "text",
      required: true,
    });
    expect(byLabel.get("Email Address")).toMatchObject({
      fieldName: "input-yOPjYfwE",
      fieldType: "email",
      required: true,
    });
    expect(byLabel.get("Country")).toMatchObject({
      fieldName: "input-yV0qYfw3",
      fieldType: "select",
      options: ["United States", "Canada"],
    });
    expect(byLabel.get("Are you authorised to work here?")).toMatchObject({
      fieldName: "yQ4kYfwW",
      fieldType: "radio",
      options: ["No", "Yes"],
    });
    expect(read.questions.find((question) => question.fieldName === "yZ9kYfwL")).toMatchObject({
      fieldType: "multiselect",
      label: "Which languages do you speak?",
      options: ["English", "French"],
    });
    expect(byLabel.get("Anything else we should know? [optional]")).toMatchObject({
      fieldName: "input-yA1kYfwM",
      fieldType: "textarea",
    });

    expect(byLabel.get("Are you willing to complete a background check?")).toMatchObject({
      fieldName: "f0",
      fieldType: "radio",
      required: true,
      options: ["Yes", "No"],
    });
    expect(byLabel.get("University Attended")).toMatchObject({
      fieldName: "input-f1",
      fieldType: "text",
      required: false,
    });
    expect(byLabel.get("Currency")).toMatchObject({
      fieldName: "input-f7",
      fieldType: "select",
      options: ["EUR", "GBP"],
    });
    expect(byLabel.get("Earliest start date")).toMatchObject({
      fieldName: "input-date8",
      fieldType: "date",
      required: true,
    });
  });

  test("returns an empty form when the page is not a Jobvite apply page", () => {
    const read = readJobviteFormHtml("<html><body>not a form</body></html>");

    expect(read.questions).toEqual([]);
    expect(read.formSignature).toBe("");
    expect(read.path).toBe("jobvite_html");
  });

  test("gives the same signature to the same field names and a different one otherwise", () => {
    const first = readJobviteFormHtml(JOBVITE_PAGE);
    const second = readJobviteFormHtml(JOBVITE_PAGE);
    const changed = readJobviteFormHtml(JOBVITE_PAGE.replaceAll("yPPjYfwF", "yPPjYfwG"));

    expect(second.formSignature).toBe(first.formSignature);
    expect(changed.formSignature).not.toBe(first.formSignature);
  });
});

describe("readHerpFormHtml", () => {
  test("reads the employer's visible fields with the locale's own labels", () => {
    const read = readHerpFormHtml(HERP_PAGE);

    expect(read.path).toBe("herp_html");
    expect(read.formSignature).toMatch(/^[0-9a-f]{16}$/u);

    const byName = new Map(read.questions.map((question) => [question.fieldName, question]));

    expect(byName.get("name")).toMatchObject({
      fieldType: "text",
      label: "Name",
      required: true,
    });
    expect(byName.get("email")).toMatchObject({ fieldType: "email", required: true });
    expect(byName.get("telephoneNumber")).toMatchObject({
      fieldType: "phone",
      label: "Phone",
      required: false,
    });
    expect(byName.get("career")).toMatchObject({
      fieldType: "textarea",
      label: "Work Experience",
    });
    expect(byName.get("messageToCompany")).toMatchObject({
      fieldType: "textarea",
      label: "Message to us",
    });
    expect(byName.get("resumes")).toMatchObject({ fieldType: "file", label: "Resume" });
    expect(byName.get("careerSummaries")).toMatchObject({ fieldType: "file", label: "CV" });
    expect(byName.get("otherFiles")).toMatchObject({
      fieldType: "file",
      label: "Other related files",
    });
    expect(byName.get("privacyPolicy")).toMatchObject({
      fieldType: "checkbox",
      label: "Agree to the Privacy Policy",
      required: true,
    });

    expect(byName.has("age")).toBe(false);
    expect(byName.has("links")).toBe(false);
    expect(byName.has("dateOfBirth")).toBe(false);
    expect(byName.has("desiredSalary")).toBe(false);
  });

  test("returns an empty form when the props are absent or the page is not an apply form", () => {
    expect(readHerpFormHtml("<html><body></body></html>").questions).toEqual([]);

    const closed = HERP_PAGE.replace('"applyFormPage":true', '"applyFormPage":false');

    expect(readHerpFormHtml(closed).questions).toEqual([]);
    expect(readHerpFormHtml(closed).formSignature).toBe("");
  });
});
