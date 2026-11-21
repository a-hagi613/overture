import { expect, test } from "bun:test";

import {
  assertNoLiveTraffic,
  createGuardedFetch,
  LiveServiceRequestError,
} from "./outbound-guard.ts";

const LIVE_URLS = [
  "https://boards-api.greenhouse.io/v1/boards/stripe/jobs",
  "https://api.lever.co/v0/postings/pyka",
  "https://jobs.lever.co/pyka/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply",
  "https://api.ashbyhq.com/posting-api/job-board/clera",
  "https://api.anthropic.com/v1/messages/batches",
  "https://api.browser-use.com/api/v3/sessions",
  "https://api.cloudflare.com/client/v4/accounts/account/email/sending/send",
  "https://hiring.cafe/api/jobs",
] as const;

for (const environment of ["test", "development"] as const) {
  test(`an outbound request to a live ATS or paid host is refused in ${environment}`, () => {
    for (const url of LIVE_URLS) {
      expect(() => assertNoLiveTraffic(url, "GET", environment)).toThrow(LiveServiceRequestError);
    }
  });
}

test("the refusal names the host, the environment and the fixture rule", () => {
  expect(() => assertNoLiveTraffic(LIVE_URLS[2], "GET", "test")).toThrow(/jobs\.lever\.co/u);
  expect(() => assertNoLiveTraffic(LIVE_URLS[2], "GET", "test")).toThrow(/a test process/u);
  expect(() => assertNoLiveTraffic(LIVE_URLS[2], "GET", "test")).toThrow(/ADR 0016/u);
  expect(() => assertNoLiveTraffic(LIVE_URLS[2], "GET", "test")).toThrow(/fixture/u);
});

test("a fixture host and an unrelated host are allowed", () => {
  expect(() =>
    assertNoLiveTraffic("http://127.0.0.1:4123/hive/job/apply", "GET", "test"),
  ).not.toThrow();
  expect(() =>
    assertNoLiveTraffic("http://localhost:3000/api/health", "GET", "test"),
  ).not.toThrow();
  expect(() =>
    assertNoLiveTraffic("https://probe.example.invalid/form", "GET", "development"),
  ).not.toThrow();
  expect(() =>
    assertNoLiveTraffic("http://127.0.0.1:4173/.well-known/openid-configuration", "GET", "test"),
  ).not.toThrow();
});

test("the guarded fetch refuses a live host and passes a fixture through", async () => {
  const fixture = Bun.serve({ fetch: () => new Response("ok"), port: 0 });

  try {
    const guarded = createGuardedFetch(globalThis.fetch, "test");

    let failure: Error | null = null;

    try {
      await guarded(LIVE_URLS[2]);
    } catch (error) {
      if (error instanceof Error) {
        failure = error;
      }
    }

    expect(failure).toBeInstanceOf(LiveServiceRequestError);

    const response = await guarded(`http://127.0.0.1:${String(fixture.port)}/hive/job/apply`);

    expect(await response.text()).toBe("ok");
  } finally {
    await fixture.stop(true);
  }
});

test("production keeps the original fetch untouched", () => {
  expect(createGuardedFetch(globalThis.fetch, "production")).toBe(globalThis.fetch);
});
