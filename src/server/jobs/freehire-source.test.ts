import { describe, expect, test } from "bun:test";

import searchFixture from "./fixtures/freehire-search-page.json";
import changesFixture from "./fixtures/freehire-changes-page.json";

import { createFreehireJobSource } from "./freehire-source.ts";
import { JobSourceError } from "./source.ts";

const clock = { now: () => 1_800_000_000_000 };

interface FixtureBody {
  readonly [key: string]: FixtureValue;
}

type FixtureValue = string | number | boolean | null | FixtureBody | readonly FixtureValue[];

function jsonResponse(
  body: FixtureBody | readonly FixtureValue[],
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

describe("freehire search", () => {
  test("sends the sendable sources, comma-separated facets and the created-at sort", async () => {
    const urls: string[] = [];

    const source = createFreehireJobSource({
      clock,
      fetchImpl: async (input) => {
        urls.push(input);

        return await Promise.resolve(jsonResponse(searchFixture));
      },
      minIntervalMs: 0,
      sleep: async () => await Promise.resolve(),
    });

    const page = await source.search({
      categories: ["backend", "frontend"],
      cities: ["Toronto"],
      countries: ["ca"],
      limit: 100,
    });

    const url = new URL(urls[0] ?? "");

    expect(url.pathname).toBe("/api/v1/jobs/search");
    expect(url.searchParams.get("category")).toBe("backend,frontend");
    expect(url.searchParams.get("countries")).toBe("ca");
    expect(url.searchParams.get("cities")).toBe("Toronto");
    expect(url.searchParams.get("source")).toContain("greenhouse");
    expect(url.searchParams.get("source")).toContain("isolvedhire");
    expect(url.searchParams.get("source")).not.toContain("linkedin");
    expect(url.searchParams.get("sort")).toBe("created_at");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(page.total).toBe(4);
    expect(page.ignoredParams).toEqual(["bogus"]);
    expect(page.jobs).toHaveLength(4);
  });

  test("keeps a blank apply_url null and a missing work_mode null instead of guessing", async () => {
    const source = createFreehireJobSource({
      clock,
      fetchImpl: async () => await Promise.resolve(jsonResponse(searchFixture)),
      minIntervalMs: 0,
      sleep: async () => await Promise.resolve(),
    });

    const page = await source.search({});
    const teacher = page.jobs.find((job) => job.public_slug === "primary-teacher-ottawa");
    const closed = page.jobs.find((job) => job.public_slug === "closed-staff-engineer");

    expect(teacher?.apply_url).toBe("");
    expect(teacher?.work_mode).toBeNull();
    expect(closed?.closed_at).toBe("2026-11-18T00:00:00Z");
  });

  test("never asks for a page beyond freehire's 100-row ceiling", async () => {
    const urls: string[] = [];

    const source = createFreehireJobSource({
      clock,
      fetchImpl: async (input) => {
        urls.push(input);

        return await Promise.resolve(jsonResponse({ data: [], meta: { total: 0 } }));
      },
      minIntervalMs: 0,
      sleep: async () => await Promise.resolve(),
    });

    await source.search({ limit: 500 });

    expect(new URL(urls[0] ?? "").searchParams.get("limit")).toBe("100");
  });
});

describe("freehire retry", () => {
  test("backs off on 429 for the Retry-After delay, then answers", async () => {
    const delays: number[] = [];
    let attempt = 0;

    const source = createFreehireJobSource({
      clock,
      fetchImpl: async () => {
        attempt += 1;

        const response =
          attempt === 1
            ? jsonResponse({ error: "rate limited" }, 429, { "retry-after": "2" })
            : jsonResponse(searchFixture);

        return await Promise.resolve(response);
      },
      minIntervalMs: 0,
      sleep: async (ms) => {
        delays.push(ms);

        await Promise.resolve();
      },
    });

    await source.search({});

    expect(attempt).toBe(2);
    expect(delays).toEqual([2000]);
  });

  test("doubles the backoff on 5xx replies", async () => {
    const delays: number[] = [];
    let attempt = 0;

    const source = createFreehireJobSource({
      baseDelayMs: 500,
      clock,
      fetchImpl: async () => {
        attempt += 1;

        const response =
          attempt < 3 ? jsonResponse({ error: "down" }, 503) : jsonResponse(searchFixture);

        return await Promise.resolve(response);
      },
      minIntervalMs: 0,
      sleep: async (ms) => {
        delays.push(ms);

        await Promise.resolve();
      },
    });

    await source.search({});

    expect(delays).toEqual([500, 1000]);
  });

  test("gives up after the final attempt and never hides the status", async () => {
    const source = createFreehireJobSource({
      clock,
      fetchImpl: async () => await Promise.resolve(jsonResponse({ error: "down" }, 502)),
      maxAttempts: 2,
      minIntervalMs: 0,
      sleep: async () => await Promise.resolve(),
    });

    let thrown: Error | null = null;

    try {
      await source.search({});
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }

    expect(thrown).toBeInstanceOf(JobSourceError);
  });

  test("does not retry a 400, which means the query itself is wrong", async () => {
    let attempt = 0;

    const source = createFreehireJobSource({
      clock,
      fetchImpl: async () => {
        attempt += 1;

        return await Promise.resolve(jsonResponse({ error: "pagination too deep" }, 400));
      },
      minIntervalMs: 0,
      sleep: async () => await Promise.resolve(),
    });

    let thrown: Error | null = null;

    try {
      await source.search({ offset: 10_000 });
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }

    expect(thrown).toBeInstanceOf(JobSourceError);
    expect(attempt).toBe(1);
  });
});

async function requestFreehireHeaders(apiKey?: string) {
  let sent: Headers | undefined;

  const options = {
    clock,
    fetchImpl: async (_input: string, init?: RequestInit) => {
      sent = new Headers(init?.headers);

      return await Promise.resolve(jsonResponse(searchFixture));
    },
    minIntervalMs: 0,
    sleep: async () => await Promise.resolve(),
  };

  const source = createFreehireJobSource(apiKey === undefined ? options : { ...options, apiKey });

  await source.search({});

  return sent;
}

describe("freehire API key", () => {
  test("sends the API plan key as a Bearer token", async () => {
    expect((await requestFreehireHeaders("fh_live_test_key"))?.get("authorization")).toBe(
      "Bearer fh_live_test_key",
    );
  });

  test("sends no authorization header on the free plan", async () => {
    expect((await requestFreehireHeaders())?.get("authorization")).toBeNull();
    expect((await requestFreehireHeaders(""))?.get("authorization")).toBeNull();
  });
});

describe("freehire change feed", () => {
  test("parses closed and opened changes with a cursor", async () => {
    const urls: string[] = [];

    const source = createFreehireJobSource({
      clock,
      fetchImpl: async (input) => {
        urls.push(input);

        return await Promise.resolve(jsonResponse(changesFixture));
      },
      minIntervalMs: 0,
      sleep: async () => await Promise.resolve(),
    });

    const page = await source.changes({ cursor: "abc" });

    expect(new URL(urls[0] ?? "").searchParams.get("cursor")).toBe("abc");
    expect(page.nextCursor).toBe("djE6MTIzNDU6OTg3");
    expect(page.hasMore).toBe(false);
    expect(page.changes).toEqual([
      {
        at: Date.parse("2026-11-21T04:10:00Z"),
        kind: "closed",
        publicSlug: "senior-go-engineer-acme",
        seq: 98_765,
      },
      {
        at: Date.parse("2026-11-21T04:11:00Z"),
        kind: "opened",
        publicSlug: "primary-teacher-ottawa",
        seq: 98_766,
      },
    ]);
  });
});
