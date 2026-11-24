import { describe, expect, test } from "bun:test";

import type { PostingIdentity } from "../posting-identity.ts";
import { HERP_CONFIRM_SELECTOR, HERP_FORM_SELECTOR, herpApplyUrl } from "./herp.ts";
import {
  JOBVITE_CONSENT_SELECTOR,
  JOBVITE_FORM_SELECTOR,
  JOBVITE_NEXT_SELECTOR,
  JOBVITE_RESUME_SELECTOR,
  jobviteApplyUrl,
} from "./jobvite.ts";
import { WAVE_2_ATS, isWaveTwoAts } from "../../../shared/ats.ts";
import { waveTwoIdentityProblem } from "../posting-identity.ts";

const baseIdentity = {
  ats: "jobvite",
  boardToken: "acme",
  companyName: "Acme",
  jobId: "JV-1001",
  url: "https://jobs.jobvite.com/acme/job/JV-1001",
} satisfies PostingIdentity;

const identity = (overrides: Partial<PostingIdentity> = {}) => ({
  ...baseIdentity,
  ...overrides,
});

describe("the Wave 2 board configuration", () => {
  test("names every board once and gives each one a distinct form selector", () => {
    expect([...WAVE_2_ATS]).toEqual(["jobvite", "herp"]);
    expect(isWaveTwoAts("jobvite")).toBe(true);
    expect(isWaveTwoAts("herp")).toBe(true);
    expect(isWaveTwoAts("catsone")).toBe(false);

    const selectors = [
      JOBVITE_FORM_SELECTOR,
      JOBVITE_CONSENT_SELECTOR,
      JOBVITE_NEXT_SELECTOR,
      JOBVITE_RESUME_SELECTOR,
      HERP_FORM_SELECTOR,
      HERP_CONFIRM_SELECTOR,
    ];

    expect(selectors.every((selector) => selector !== "")).toBe(true);
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  test("derives the apply URL from a posting URL without duplicating /apply", () => {
    expect(jobviteApplyUrl("https://jobs.jobvite.com/acme/job/JV-1001")).toBe(
      "https://jobs.jobvite.com/acme/job/JV-1001/apply",
    );
    expect(jobviteApplyUrl("https://jobs.jobvite.com/acme/job/JV-1001/apply")).toBe(
      "https://jobs.jobvite.com/acme/job/JV-1001/apply",
    );
    expect(jobviteApplyUrl("https://jobs.jobvite.com/acme/jobs")).toBeNull();

    expect(herpApplyUrl("https://herp.careers/v1/acme/JV-1001")).toBe(
      "https://herp.careers/v1/acme/JV-1001/apply",
    );
    expect(herpApplyUrl("https://herp.careers/v1/acme/JV-1001/apply")).toBe(
      "https://herp.careers/v1/acme/JV-1001/apply",
    );
    expect(herpApplyUrl("https://herp.careers/v1/acme")).toBeNull();
  });
});

describe("Wave 2 posting identity", () => {
  test("accepts the expected Jobvite posting on the apply path", () => {
    expect(
      waveTwoIdentityProblem(identity(), "https://jobs.jobvite.com/acme/job/JV-1001/apply"),
    ).toBeNull();
  });

  test("accepts the expected HERP posting on the apply path", () => {
    const herp = identity({
      ats: "herp",
      jobId: "HP-1001",
      url: "https://herp.careers/v1/acme/HP-1001",
    });

    expect(waveTwoIdentityProblem(herp, "https://herp.careers/v1/acme/HP-1001/apply")).toBeNull();
  });

  test("rejects a page for another job", () => {
    expect(
      waveTwoIdentityProblem(identity(), "https://jobs.jobvite.com/acme/job/JV-9999/apply"),
    ).toBe("job_id");
  });

  test("rejects another board's host", () => {
    expect(waveTwoIdentityProblem(identity(), "https://herp.careers/v1/acme/JV-1001/apply")).toBe(
      "host",
    );
  });

  test("rejects a HERP page that carries another board token", () => {
    const herp = identity({
      ats: "herp",
      jobId: "HP-1001",
      url: "https://herp.careers/v1/acme/HP-1001",
    });

    expect(waveTwoIdentityProblem(herp, "https://herp.careers/v1/other/HP-1001/apply")).toBe(
      "board_token",
    );
  });

  test("accepts a local fixture host without inventing a board title match", () => {
    const fixture = identity({
      boardToken: "acme",
      url: "http://127.0.0.1:4010/acme/job/JV-1001/apply",
    });

    expect(waveTwoIdentityProblem(fixture, fixture.url)).toBeNull();
  });
});
