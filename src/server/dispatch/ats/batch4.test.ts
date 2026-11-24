import { describe, expect, test } from "bun:test";

import type { PostingIdentity } from "../posting-identity.ts";
import { BATCH_4_ATS, isBatchFourAts } from "../../../shared/ats.ts";
import { batchFourIdentityProblem } from "../posting-identity.ts";
import { HIRINGTHING_FORM_SELECTOR } from "./hiringthing.ts";
import { RIPPLING_FORM_SELECTOR } from "./rippling.ts";
import { GEM_FORM_SELECTOR } from "./gem.ts";
import { ISOLVED_HIRE_FORM_SELECTOR } from "./isolved-hire.ts";
import { APPLICANTPRO_FORM_SELECTOR } from "./applicantpro.ts";
import { CATSONE_FORM_SELECTOR } from "./catsone.ts";
import { ONLYFY_FORM_SELECTOR } from "./onlyfy.ts";
import { VARBI_FORM_SELECTOR } from "./varbi.ts";

const baseIdentity = {
  ats: "rippling",
  boardToken: "acme",
  companyName: "Acme",
  jobId: "RIP-1001",
  url: "https://jobs.rippling.com/acme/jobs/RIP-1001/apply",
} satisfies PostingIdentity;

const identity = (overrides: Partial<PostingIdentity> = {}) => ({
  ...baseIdentity,
  ...overrides,
});

describe("the Batch 4 board configuration", () => {
  test("names every board once and gives each one form selector", () => {
    expect([...BATCH_4_ATS]).toHaveLength(8);
    expect(new Set(BATCH_4_ATS).size).toBe(8);

    for (const ats of BATCH_4_ATS) {
      expect(isBatchFourAts(ats)).toBe(true);
    }

    const selectors = [
      HIRINGTHING_FORM_SELECTOR,
      RIPPLING_FORM_SELECTOR,
      GEM_FORM_SELECTOR,
      ISOLVED_HIRE_FORM_SELECTOR,
      APPLICANTPRO_FORM_SELECTOR,
      CATSONE_FORM_SELECTOR,
      ONLYFY_FORM_SELECTOR,
      VARBI_FORM_SELECTOR,
    ];

    expect(new Set(selectors).size).toBe(selectors.length);
    expect(selectors.every((selector) => selector !== "")).toBe(true);
    expect(isBatchFourAts("greenhouse")).toBe(false);
  });
});

describe("Batch 4 posting identity", () => {
  test("accepts the expected job on the board's own host", () => {
    const url = "https://jobs.rippling.com/acme/jobs/RIP-1001/apply";

    expect(batchFourIdentityProblem(identity({ url }), url)).toBeNull();
  });

  test("rejects a page for another job", () => {
    const live = "https://jobs.rippling.com/acme/jobs/RIP-9999/apply";

    expect(batchFourIdentityProblem(identity(), live)).toBe("job_id");
  });

  test("rejects another ATS's host even when the job id matches", () => {
    const live = "https://jobs.catsone.com/acme/jobs/RIP-1001/apply";

    expect(batchFourIdentityProblem(identity(), live)).toBe("host");
  });

  test("rejects a live path that does not carry the expected board token", () => {
    const live = "https://jobs.rippling.com/acme/jobs/RIP-1001/apply";

    expect(batchFourIdentityProblem(identity({ boardToken: "other" }), live)).toBe("board_token");
  });

  test("accepts a local fixture host without inventing a company title match", () => {
    const expected = identity({
      boardToken: "acme",
      url: "http://127.0.0.1:4010/rippling/apply/RIP-1001",
    });

    expect(batchFourIdentityProblem(expected, expected.url)).toBeNull();
  });
});
