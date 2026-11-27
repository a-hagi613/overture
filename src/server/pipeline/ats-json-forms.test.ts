import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  bamboohrDetailUrl,
  manatalApplyUrl,
  manatalJobIdFromPage,
  readBambooHRFormJson,
  readManatalFormJson,
  readZohoRecruitFormJson,
  zohoRecruitApplyFormUrl,
} from "./ats-json-forms.ts";
import { createPlainFormReader, isLoginWallRead } from "./form-read.ts";

const fixture = (path: string) =>
  readFileSync(new URL(`../../../test/e2e/fixtures/forms/${path}`, import.meta.url), "utf8");

describe("the BambooHR application-form detail read", () => {
  test("reads every standard and custom field from the careers detail response", () => {
    const read = readBambooHRFormJson(fixture("bamboohr/islqatar-101.detail.json"));

    expect(read?.path).toBe("bamboohr_html");
    expect(read?.formLoaded).toBe(true);
    expect(read?.questions.map((question) => question.fieldName)).toEqual([
      "firstName",
      "lastName",
      "email",
      "phone",
      "streetAddress.value",
      "city.value",
      "state.value",
      "zip.value",
      "countryId.value",
      "linkedinUrl",
      "dateAvailable",
      "desiredPay",
      "websiteUrl",
      "references",
      "resumeFileId",
      "customQuestionAnswers.short_496",
      "customQuestionAnswers.short_497",
      "customQuestionAnswers.short_498",
    ]);
    expect(read?.questions[0]).toMatchObject({
      fieldType: "text",
      label: "First Name",
      required: true,
    });
    expect(read?.questions[2]).toMatchObject({ fieldType: "email", label: "Email" });
    expect(read?.questions[8]).toMatchObject({
      fieldType: "select",
      label: "Country",
      required: true,
    });
    expect(read?.questions[8]?.options).toContain("Qatar");
    expect(read?.questions[14]).toMatchObject({
      fieldType: "file",
      label: "Resume",
      required: true,
    });
    expect(read?.questions[15]).toMatchObject({
      fieldType: "text",
      label:
        "Please indicate what passport(s) you hold, as this information is required for processing a Qatar work visa",
      required: false,
    });
  });

  test("turns the posting URL into its detail endpoint", () => {
    expect(bamboohrDetailUrl("https://islqatar.bamboohr.com/careers/101")).toBe(
      "https://islqatar.bamboohr.com/careers/101/detail",
    );
    expect(bamboohrDetailUrl("https://acme.bamboohr.com/careers/95?utm_source=freehire.me")).toBe(
      "https://acme.bamboohr.com/careers/95/detail",
    );
    expect(bamboohrDetailUrl("https://acme.bamboohr.com/about")).toBeNull();
  });
});

describe("the Zoho Recruit application-form read", () => {
  const page = fixture("zoho-recruit/icschools-769705000015883276.page.html");

  test("builds the public apply-form endpoint from the page meta", () => {
    expect(
      zohoRecruitApplyFormUrl(
        page,
        "https://icschools.zohorecruit.com/jobs/Careers/769705000015883276",
      ),
    ).toEqual({
      jobId: "769705000015883276",
      url: "https://icschools.zohorecruit.com/recruit/v2/public/Job_Openings/769705000015883276/apply/769705000000496659?pagename=Careers&source=CareerSite",
    });
  });

  test("reads visible fields and attachments, never the captcha or a tabular section", () => {
    const read = readZohoRecruitFormJson(
      fixture("zoho-recruit/icschools-769705000015883276.webform.json"),
    );

    expect(read?.path).toBe("zoho_recruit_html");
    expect(read?.formLoaded).toBe(true);
    expect(read?.questions.map((question) => question.fieldName)).toEqual([
      "rec-form_769705000000063542",
      "rec-form_769705000000063600",
      "rec-form_769705000000063544",
      "rec-form_769705000000063548",
      "rec-form_769705000000063554",
      "rec-form_769705000001129324",
      "rec-form_769705000001129341",
      "rec-form_769705000000063560",
      "rec-form_769705000000063566",
      "rec-form_769705000000063562",
      "rec-form_769705000000063564",
      "rec-form_769705000000063568",
      "rec-form_769705000000063574",
      "rec-form_769705000000063576",
      "rec-form_769705000001842001",
      "rec-form_769705000001842002",
      "rec-form_111222333443_file",
      "rec-form_769705000000072325_file",
    ]);
    expect(read?.questions[0]).toMatchObject({
      fieldType: "text",
      label: "First Name",
      required: false,
    });
    expect(read?.questions[2]).toMatchObject({
      fieldType: "text",
      label: "Last Name",
      required: true,
    });
    expect(read?.questions[5]).toMatchObject({
      fieldType: "select",
      label: "Gender",
      options: ["Male", "Female", "Other"],
      required: true,
    });
    expect(read?.questions[17]).toMatchObject({
      fieldType: "file",
      label: "Resume",
      required: false,
    });
    expect(read?.questions.some((question) => question.label === "CAPTCHA")).toBe(false);
    expect(read?.questions.some((question) => question.label === "Institute / School")).toBe(false);
  });
});

describe("the Manatal application-form read", () => {
  test("opens the apply route and reads the job id the form API needs", () => {
    expect(manatalApplyUrl("https://www.careers-page.com/flexstaf-it/job/W3994VR9")).toBe(
      "https://www.careers-page.com/flexstaf-it/job/W3994VR9/apply",
    );
    expect(manatalApplyUrl("https://www.careers-page.com/flexstaf-it/job/W3994VR9/apply")).toBe(
      "https://www.careers-page.com/flexstaf-it/job/W3994VR9/apply",
    );
    expect(manatalApplyUrl("https://www.careers-page.com/flexstaf-it")).toBeNull();

    expect(manatalJobIdFromPage(fixture("manatal/flexstaf-W3994VR9.apply.html"))).toBe("4611702");
  });

  test("reads the form fields with their ids, labels, types and required flags", () => {
    const read = readManatalFormJson(fixture("manatal/flexstaf-W3994VR9.application-form.json"));

    expect(read?.path).toBe("manatal_html");
    expect(read?.formLoaded).toBe(true);
    expect(read?.questions).toEqual([
      {
        fieldName: "1187745",
        fieldType: "text",
        label: "Full Name",
        options: [],
        required: true,
      },
      {
        fieldName: "1187746",
        fieldType: "email",
        label: "Email",
        options: [],
        required: true,
      },
      {
        fieldName: "1187747",
        fieldType: "phone",
        label: "Phone",
        options: [],
        required: true,
      },
      {
        fieldName: "1187748",
        fieldType: "textarea",
        label: "Cover Letter",
        options: [],
        required: false,
      },
      {
        fieldName: "1187749",
        fieldType: "file",
        label: "Resume",
        options: [],
        required: true,
      },
    ]);
  });
});

describe("the plain reader's JSON form routes", () => {
  test("fetches each board's detail or form API instead of parsing its app shell", async () => {
    const bamboo = fixture("bamboohr/islqatar-101.detail.json");
    const zohoPage = fixture("zoho-recruit/icschools-769705000015883276.page.html");
    const zohoForm = fixture("zoho-recruit/icschools-769705000015883276.webform.json");
    const manatalPage = fixture("manatal/flexstaf-W3994VR9.apply.html");
    const manatalForm = fixture("manatal/flexstaf-W3994VR9.application-form.json");
    const requested: string[] = [];

    const fetcher = async (input: RequestInfo | URL) => {
      const href = input instanceof Request ? input.url : input.toString();

      requested.push(href);

      if (href.endsWith("/careers/101/detail")) {
        return await Promise.resolve(new Response(bamboo, { status: 200 }));
      }

      if (href.includes("/recruit/v2/public/Job_Openings/")) {
        return await Promise.resolve(new Response(zohoForm, { status: 200 }));
      }

      if (href.endsWith("/api/v1.0/jobs/4611702/application-form/")) {
        return await Promise.resolve(new Response(manatalForm, { status: 200 }));
      }

      if (new URL(href).hostname === "icschools.zohorecruit.com") {
        return await Promise.resolve(new Response(zohoPage, { status: 200 }));
      }

      if (href.endsWith("/apply")) {
        return await Promise.resolve(new Response(manatalPage, { status: 200 }));
      }

      return await Promise.resolve(new Response("<html>not a form</html>", { status: 200 }));
    };

    const reader = createPlainFormReader({ fetcher });

    const target = {
      applyUrl: null,
      boardToken: "acme",
      region: "us",
    } as const;

    const reads = await Promise.all([
      reader.read({
        ...target,
        ats: "bamboohr",
        atsJobId: "101",
        url: "https://islqatar.bamboohr.com/careers/101",
      }),
      reader.read({
        ...target,
        ats: "zoho_recruit",
        atsJobId: "769705000015883276",
        url: "https://icschools.zohorecruit.com/jobs/Careers/769705000015883276",
      }),
      reader.read({
        ...target,
        ats: "manatal",
        atsJobId: "W3994VR9",
        url: "https://www.careers-page.com/flexstaf-it/job/W3994VR9",
      }),
    ]);

    const forms = reads.map((read) => (isLoginWallRead(read) ? null : read));

    expect(forms.map((form) => form?.path)).toEqual([
      "bamboohr_html",
      "zoho_recruit_html",
      "manatal_html",
    ]);

    for (const form of forms) {
      const loaded = form !== null && "formLoaded" in form ? form.formLoaded : undefined;

      expect(loaded).toBe(true);
      expect(form?.questions.length).toBeGreaterThan(0);
    }

    expect(requested.toSorted()).toEqual(
      [
        "https://islqatar.bamboohr.com/careers/101/detail",
        "https://icschools.zohorecruit.com/jobs/Careers/769705000015883276",
        "https://icschools.zohorecruit.com/recruit/v2/public/Job_Openings/769705000015883276/apply/769705000000496659?pagename=Careers&source=CareerSite",
        "https://www.careers-page.com/flexstaf-it/job/W3994VR9/apply",
        "https://www.careers-page.com/api/v1.0/jobs/4611702/application-form/",
      ].toSorted(),
    );
  });
});

describe("empty and unreadable application forms", () => {
  test("an empty but readable form keeps a signature so preparation can continue", () => {
    const bamboo = readBambooHRFormJson(JSON.stringify({ result: { formFields: {} } }));
    const zoho = readZohoRecruitFormJson(JSON.stringify({ webforms: [{ sections: [] }] }));
    const manatal = readManatalFormJson("[]");

    for (const read of [bamboo, zoho, manatal]) {
      expect(read?.formLoaded).toBe(true);
      expect(read?.questions).toEqual([]);
      expect(read?.formSignature).toMatch(/^[0-9a-f]{16}$/u);
    }
  });

  test("a malformed or missing payload is unreadable", () => {
    expect(readBambooHRFormJson("<html>sign in</html>")).toBeNull();
    expect(readBambooHRFormJson(JSON.stringify({ result: {} }))).toBeNull();
    expect(readZohoRecruitFormJson("not json")).toBeNull();
    expect(readZohoRecruitFormJson(JSON.stringify({ code: "error" }))).toBeNull();
    expect(readManatalFormJson("{}")).toBeNull();
    expect(manatalJobIdFromPage("<html>no job here</html>")).toBeNull();
    expect(
      zohoRecruitApplyFormUrl(
        "<html>no meta</html>",
        "https://acme.zohorecruit.com/jobs/Careers/1",
      ),
    ).toBeNull();
  });
});
