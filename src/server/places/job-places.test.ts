import { describe, expect, test } from "bun:test";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { jobPlaceIds } from "./job-places.ts";

const base: FreehireJobRecord = {
  apply_url: null,
  cities: ["Toronto"],
  closed_at: null,
  company: "Acme",
  company_slug: "acme",
  countries: ["ca"],
  created_at: "2026-11-20T09:00:00Z",
  description: null,
  enrichment: { category: "backend" },
  external_id: "acme:1",
  location: "Toronto, Canada",
  metros: null,
  posted_at: "2026-11-20T00:00:00Z",
  public_slug: "acme-1",
  reality: null,
  regions: null,
  skills: null,
  source: "greenhouse",
  title: "Engineer",
  url: null,
  work_mode: null,
};

function ids(overrides: Partial<FreehireJobRecord>) {
  return jobPlaceIds({ ...base, ...overrides });
}

describe("a freehire posting's place ids", () => {
  test("a remote posting carries its physical places, its remote scopes and worldwide", () => {
    const places = ids({ work_mode: "remote" });

    expect(places).toContain("country:ca");
    expect(places).toContain("city:ca:toronto");
    expect(places).toContain("remote:country:ca");
    expect(places).toContain("remote:continent:NA");
    expect(places).toContain("remote:worldwide");
    expect(places).not.toContain("remote:country:us");
  });

  test("a remote posting with no country matches only Remote · Worldwide", () => {
    expect(ids({ cities: [], countries: [], work_mode: "remote" })).toEqual(["remote:worldwide"]);
  });

  test("a posting with no country and no work mode is left out", () => {
    expect(ids({ cities: [], countries: [], work_mode: null })).toEqual([]);
    expect(ids({ cities: [], countries: [], work_mode: "hybrid" })).toEqual([]);
  });

  test("a posting with a work mode but not remote matches only its physical places", () => {
    const places = ids({ work_mode: "hybrid" });

    expect(places).toEqual(["city:ca:toronto", "country:ca"]);
  });

  test("freehire regions map to their region id and add the remote continent", () => {
    const places = ids({ regions: ["north_america"], work_mode: "remote" });

    expect(places).toContain("region:north_america");
    expect(places).toContain("remote:continent:NA");
  });

  test("a country name freehire puts in its city facet never becomes a city", () => {
    const places = ids({ cities: ["Canada"], work_mode: "remote" });

    expect(places).not.toContain("city:ca:canada");
    expect(places).toContain("country:ca");
  });

  test("a city is written once per country the posting lists", () => {
    const places = ids({ cities: ["London"], countries: ["ca", "gb"], work_mode: null });

    expect(places).toContain("city:ca:london");
    expect(places).toContain("city:gb:london");
  });

  test("an upper-case or named country is normalised to its code", () => {
    expect(ids({ countries: ["CA"], work_mode: null })).toContain("country:ca");
    expect(ids({ countries: ["Germany"], work_mode: null })).toContain("country:de");
  });
});
