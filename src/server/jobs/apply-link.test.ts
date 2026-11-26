import { describe, expect, test } from "bun:test";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { directApplyUrl, goUrlFor, resolveApplyTarget, stripUtm } from "./apply-link.ts";

const record: (overrides?: Partial<FreehireJobRecord>) => FreehireJobRecord = (overrides = {}) => ({
  apply_url: null,
  cities: null,
  closed_at: null,
  company: "Acme",
  company_slug: "acme",
  countries: null,
  created_at: null,
  description: null,
  enrichment: null,
  external_id: "acme:123",
  location: null,
  metros: null,
  posted_at: null,
  public_slug: "senior-go-engineer-acme",
  reality: null,
  regions: null,
  skills: null,
  source: "greenhouse",
  title: "Senior Go Engineer",
  url: null,
  work_mode: null,
  ...overrides,
});

describe("apply link formatting", () => {
  test("formats Lever, Greenhouse and Ashby from the board token", () => {
    expect(directApplyUrl("lever", "acme", "123")).toBe("https://jobs.lever.co/acme/123/apply");
    expect(directApplyUrl("greenhouse", "acme", "123")).toBe(
      "https://job-boards.greenhouse.io/acme/jobs/123",
    );
    expect(directApplyUrl("ashby", "acme", "123")).toBe("https://jobs.ashbyhq.com/acme/123");
    expect(directApplyUrl("workable", "acme", "123")).toBeNull();
  });

  test("reads the board token from the part of external_id before the colon", async () => {
    const target = await resolveApplyTarget(record({ external_id: "acme-board:job-9" }));

    expect(target).toMatchObject({
      applyUrl: "https://job-boards.greenhouse.io/acme-board/jobs/job-9",
      ats: "greenhouse",
      atsJobId: "job-9",
      boardToken: "acme-board",
      via: "direct",
    });
  });

  test("follows the go link once for another sender and strips utm tracking", async () => {
    const requested: string[] = [];

    const target = await resolveApplyTarget(
      record({
        apply_url: "https://freehire.me/api/v1/go/senior-go-engineer-acme?src=web",
        external_id: "acme:123",
        source: "workable",
      }),
      {
        fetchImpl: async (input) => {
          requested.push(input);

          const response = new Response(null, {
            headers: {
              location:
                "https://apply.workable.com/acme/j/123?utm_source=freehire.me&utm_medium=api&ref=board",
            },
            status: 302,
          });

          return await Promise.resolve(response);
        },
      },
    );

    expect(requested).toEqual(["https://freehire.me/api/v1/go/senior-go-engineer-acme?src=web"]);
    expect(target?.via).toBe("go");
    expect(target?.applyUrl).toBe("https://apply.workable.com/acme/j/123?ref=board");
  });

  test("falls back to the go link when apply_url is blank", () => {
    expect(goUrlFor(record({ apply_url: "" }))).toBe(
      "https://freehire.me/api/v1/go/senior-go-engineer-acme",
    );
    expect(goUrlFor(record({ apply_url: null }))).toBe(
      "https://freehire.me/api/v1/go/senior-go-engineer-acme",
    );
  });

  test("follows freehire's go link when apply_url is missing", async () => {
    const requested: string[] = [];

    const target = await resolveApplyTarget(record({ apply_url: null, source: "workable" }), {
      fetchImpl: async (input) => {
        requested.push(input);

        return await Promise.resolve(
          new Response(null, {
            headers: { location: "https://apply.workable.com/acme/j/123" },
            status: 302,
          }),
        );
      },
    });

    expect(requested).toEqual(["https://freehire.me/api/v1/go/senior-go-engineer-acme"]);
    expect(target?.via).toBe("go");
  });

  test("has no target for a source with no sender", async () => {
    expect(await resolveApplyTarget(record({ source: "linkedin" }))).toBeNull();
  });

  test("has no target when the redirect answers without a Location", async () => {
    const target = await resolveApplyTarget(record({ source: "workable" }), {
      fetchImpl: async () => await Promise.resolve(new Response(null, { status: 302 })),
    });

    expect(target).toBeNull();
  });

  test("leaves a non-url untouched when stripping utm", () => {
    expect(stripUtm("not a url")).toBe("not a url");
  });
});
