import { describe, expect, test } from "bun:test";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { detectLanguage } from "../catalog/language.ts";
import {
  FILTER_PERSONAS,
  isRightJob,
  loadRecordedPull,
  locationMatches,
  preferencesFor,
  runFilterProof,
} from "./filter-proof.ts";

function record(overrides: Partial<FreehireJobRecord>) {
  return {
    apply_url: null,
    cities: ["Toronto"],
    closed_at: null,
    company: "Acme",
    company_slug: "acme",
    countries: ["ca"],
    created_at: "2026-11-20T09:00:00Z",
    description: null,
    enrichment: { category: "backend" },
    external_id: `acme:${overrides.public_slug ?? "job"}`,
    location: "Toronto, Canada",
    metros: null,
    posted_at: "2026-11-20T00:00:00Z",
    public_slug: overrides.public_slug ?? "job",
    reality: null,
    regions: null,
    skills: null,
    source: "greenhouse",
    title: "Backend Engineer",
    url: null,
    work_mode: null,
    ...overrides,
  } satisfies FreehireJobRecord;
}

const nurse = FILTER_PERSONAS.find((persona) => persona.key === "nurse");
const backend = FILTER_PERSONAS.find((persona) => persona.key === "backend-engineer");

describe("the filter-proof personas", () => {
  test("all 12 graded fields, King Kong and the three walk users are present", () => {
    expect(FILTER_PERSONAS.filter((persona) => persona.group === "graded")).toHaveLength(12);
    expect(FILTER_PERSONAS.filter((persona) => persona.group === "owner")).toHaveLength(1);
    expect(FILTER_PERSONAS.filter((persona) => persona.group === "walk")).toHaveLength(3);
    expect(FILTER_PERSONAS.map((persona) => persona.key)).toContain("king-kong");
    expect(FILTER_PERSONAS.map((persona) => persona.key)).toContain("maya");
  });

  test("preferences carry the filter's categories, title words, languages and exact place ids", () => {
    if (backend === undefined) {
      throw new Error("backend persona missing");
    }

    const preferences = preferencesFor(backend);

    expect(preferences.categories).toContain("backend");
    expect(preferences.titleWords).toContain("backend");
    expect(preferences.languages).toEqual(["en"]);
    expect(preferences.placeIds).toContain("city:ca:toronto");
    expect(preferences.placeIds).toContain("remote:country:ca");
  });
});

describe("the independent grade", () => {
  test("a nurse posting in Toronto is right; an accountant posting is wrong", () => {
    if (nurse === undefined) {
      throw new Error("nurse persona missing");
    }

    const right = {
      category: "healthcare",
      cities: '["Toronto"]',
      countries: '["ca"]',
      language: "en",
      title: "Registered Nurse - Cardiology",
      workMode: null,
    };

    expect(isRightJob(right, nurse)).toBe(true);
    expect(isRightJob({ ...right, category: "finance", title: "Accountant" }, nurse)).toBe(false);
  });

  test("a remote country place needs a remote posting, and a city place ignores the country alone", () => {
    const places = [
      { country: "ca", id: "remote:country:ca", remote: true },
      { city: "ottawa", country: "ca", id: "city:ca:ottawa" },
    ];

    const remoteCanada = {
      cities: null,
      countries: '["ca"]',
      workMode: "remote",
    };

    const onsiteToronto = {
      cities: '["Toronto"]',
      countries: '["ca"]',
      workMode: "onsite",
    };

    const ottawa = {
      cities: '["Ottawa"]',
      countries: '["ca"]',
      workMode: null,
    };

    expect(locationMatches(remoteCanada, places)).toBe(true);
    expect(locationMatches(onsiteToronto, places)).toBe(false);
    expect(locationMatches(ottawa, places)).toBe(true);
  });

  test("a posting in a language the person does not read is not right", () => {
    if (nurse === undefined) {
      throw new Error("nurse persona missing");
    }

    expect(
      isRightJob(
        {
          category: "healthcare",
          cities: '["Toronto"]',
          countries: '["ca"]',
          language: "ja",
          title: "看護師",
          workMode: null,
        },
        nurse,
      ),
    ).toBe(false);
  });

  test("a talent pool or test row is never right", () => {
    if (nurse === undefined) {
      throw new Error("nurse persona missing");
    }

    expect(
      isRightJob(
        {
          category: "healthcare",
          cities: '["Toronto"]',
          countries: '["ca"]',
          language: "en",
          title: "Talent Pool - Registered Nurse",
          workMode: null,
        },
        nurse,
      ),
    ).toBe(false);
  });
});

describe("the production reader on a recorded pull", () => {
  test("counts a wrong-field job, a missed right job and a title-only match", () => {
    const result = runFilterProof([
      record({
        cities: ["Toronto"],
        enrichment: { category: "backend" },
        public_slug: "right-category",
        title: "Backend Engineer",
      }),
      record({
        cities: ["Toronto"],
        enrichment: { category: "other" },
        public_slug: "title-only",
        title: "Backend Developer",
      }),
      record({
        cities: ["Berlin"],
        countries: ["de"],
        enrichment: { category: "backend" },
        public_slug: "wrong-place",
        title: "Backend Platform Engineer",
      }),
      record({
        cities: ["Toronto"],
        enrichment: { category: "other" },
        public_slug: "missed-right",
        title: "Programmer Analyst",
      }),
      record({
        cities: ["Toronto"],
        enrichment: { category: "backend" },
        public_slug: "talent-pool",
        title: "Talent Pool",
      }),
    ]);

    const kingKong = result.personas.find((persona) => persona.key === "king-kong");

    expect(kingKong?.pool).toBe(2);
    expect(kingKong?.rightJobs).toBe(3);
    expect(kingKong?.missedRight).toBe(1);
    expect(kingKong?.wrongField).toBe(0);
    expect(kingKong?.locationWrong).toBe(0);
    expect(kingKong?.titleOnly).toBe(1);
    expect(kingKong?.titleOnlyNullCategory).toBe(0);
    expect(kingKong?.titleOnlyOtherCategory).toBe(1);
  });

  test("the recorded pull loads, is production-sized and contains the Japanese posting the detector fixes", () => {
    const records = loadRecordedPull(
      "src/server/jobs/fixtures/filter-proof/freehire-pull-2026-11-26.json.gz",
    );

    expect(records.length).toBeGreaterThan(5000);
    expect(
      records.some((job) => detectLanguage(job.description ?? "") === "ja" && job.title.length > 0),
    ).toBe(true);
  });
});
