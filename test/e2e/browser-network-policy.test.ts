import { expect, test } from "@playwright/test";
import { z } from "zod";

import { BrowserUseClient } from "../../src/server/dispatch/browser/browser-use.ts";
import {
  NETWORK_POLICY_NAME,
  createNetworkPolicyResolver,
  proxyTrimNetworkPolicy,
} from "../../src/server/dispatch/browser/network-policy.ts";
import {
  CAPTCHA_HOSTS,
  TRACKER_HOSTS,
  shouldTrimRequest,
} from "../../src/server/dispatch/browser/proxy-trim.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";

const policyInputSchema = z.object({
  name: z.string().min(1).max(100),
  defaultAction: z.enum(["allow", "block"]).optional(),
  allow: z.object({ domains: z.array(z.string().min(1)) }).optional(),
  block: z.object({ domains: z.array(z.string().min(1)) }).optional(),
});

const policyPatchSchema = policyInputSchema.partial();

const storedPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  defaultAction: z.enum(["allow", "block"]),
  allow: z.object({ domains: z.array(z.string()) }),
  block: z.object({ domains: z.array(z.string()) }),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const sessionRequestSchema = z.object({
  metadata: z.record(z.string(), z.string()),
  networkPolicyId: z.string().min(1).optional(),
  profileId: z.string().nullable(),
  proxyCountryCode: z.string().length(2),
  solveCaptchas: z.boolean(),
  timeout: z.number().int().positive(),
});

type PolicyInput = z.infer<typeof policyInputSchema>;

type PolicyPatch = z.infer<typeof policyPatchSchema>;

type StoredPolicy = z.infer<typeof storedPolicySchema>;

type SessionRequest = z.infer<typeof sessionRequestSchema>;

function startFixture(seed: StoredPolicy[] = []) {
  const policies = [...seed];
  const createBodies: PolicyInput[] = [];
  const patchBodies: PolicyPatch[] = [];
  const sessionBodies: SessionRequest[] = [];
  let listCalls = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && path === "/api/v4/network-policies") {
        listCalls += 1;

        return Response.json({
          items: [...policies].toReversed(),
          pageNumber: 1,
          pageSize: 100,
          totalItems: policies.length,
        });
      }

      if (request.method === "POST" && path === "/api/v4/network-policies") {
        const parsed = policyInputSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid policy" }, { status: 422 });
        }

        const now = new Date().toISOString();

        const policy: StoredPolicy = {
          allow: parsed.data.allow ?? { domains: [] },
          block: parsed.data.block ?? { domains: [] },
          createdAt: now,
          defaultAction: parsed.data.defaultAction ?? "allow",
          id: `policy-${String(policies.length + 1)}`,
          name: parsed.data.name,
          updatedAt: now,
          version: 1,
        };

        policies.push(policy);
        createBodies.push(parsed.data);

        return Response.json(policy, { status: 201 });
      }

      if (path.startsWith("/api/v4/network-policies/") && request.method === "PATCH") {
        const id = path.slice("/api/v4/network-policies/".length);
        const policy = policies.find((candidate) => candidate.id === id);

        if (policy === undefined) {
          return Response.json({ detail: "not found" }, { status: 404 });
        }

        const parsed = policyPatchSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid policy" }, { status: 422 });
        }

        patchBodies.push(parsed.data);
        policy.allow = parsed.data.allow ?? policy.allow;
        policy.block = parsed.data.block ?? policy.block;
        policy.defaultAction = parsed.data.defaultAction ?? policy.defaultAction;
        policy.name = parsed.data.name ?? policy.name;
        policy.updatedAt = new Date().toISOString();
        policy.version += 1;

        return Response.json(policy);
      }

      if (request.method === "POST" && path === "/api/v4/browsers") {
        const parsed = sessionRequestSchema.safeParse(await request.json());

        if (!parsed.success) {
          return Response.json({ detail: "invalid session" }, { status: 422 });
        }

        sessionBodies.push(parsed.data);

        return Response.json(
          {
            id: "session-1",
            startedAt: new Date(clock.now()).toISOString(),
            status: "active",
            timeoutAt: new Date(clock.now() + 15 * 60_000).toISOString(),
          },
          { status: 201 },
        );
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    close: () => {
      void server.stop(true);
    },
    createBodies,
    get listCalls() {
      return listCalls;
    },
    patchBodies,
    policies,
    sessionBodies,
    url: `http://127.0.0.1:${String(server.port)}`,
  };
}

const clock = createClock();

test("the proxy network policy blocks trackers and never a CAPTCHA host", () => {
  const policy = proxyTrimNetworkPolicy();

  expect(policy.name).toBe(NETWORK_POLICY_NAME);
  expect(policy.defaultAction).toBe("allow");

  for (const host of TRACKER_HOSTS) {
    expect(policy.block.domains).toContain(host);
  }

  for (const host of CAPTCHA_HOSTS) {
    expect(policy.allow.domains).toContain(host);
    expect(policy.block.domains).not.toContain(host);
  }
});

test("images, scripts and XHR are never trimmed, and a CAPTCHA script is kept", () => {
  for (const resourceType of ["image", "script", "xhr", "fetch", "document"]) {
    expect(shouldTrimRequest("https://job-boards.greenhouse.io/app.js", resourceType)).toBe(false);
  }

  expect(shouldTrimRequest("https://challenges.cloudflare.com/turnstile.js", "script")).toBe(false);
  expect(shouldTrimRequest("https://hcaptcha.com/captcha.js", "script")).toBe(false);
});

test("the resolver creates the policy once and every session carries its id", async () => {
  const fixture = startFixture();
  const client = BrowserUseClient("test-key", fixture.url, clock);

  try {
    const resolve = createNetworkPolicyResolver(client);
    const id = await resolve();

    expect(id).toBe("policy-1");
    expect(await resolve()).toBe(id);
    expect(fixture.policies).toHaveLength(1);
    expect(fixture.listCalls).toBe(1);

    const [created] = fixture.createBodies;

    expect(created?.name).toBe(NETWORK_POLICY_NAME);
    expect(created?.defaultAction).toBe("allow");
    expect(created?.block?.domains).toContain("doubleclick.net");
    expect(created?.allow?.domains).toContain("challenges.cloudflare.com");

    await client.createSession({
      metadata: { attemptId: "attempt-1" },
      networkPolicyId: id,
      profileId: null,
      proxyCountryCode: "ca",
      solveCaptchas: true,
      timeoutMinutes: 15,
    });

    expect(fixture.sessionBodies).toEqual([
      {
        metadata: { attemptId: "attempt-1" },
        networkPolicyId: "policy-1",
        profileId: null,
        proxyCountryCode: "ca",
        solveCaptchas: true,
        timeout: 15,
      },
    ]);
  } finally {
    fixture.close();
  }
});

test("the resolver patches an existing policy by name and keeps its allow list intact", async () => {
  const existing = proxyTrimNetworkPolicy();
  const now = new Date().toISOString();

  const fixture = startFixture([
    {
      ...existing,
      allow: { domains: ["cdn.example.com"] },
      block: { domains: ["stale-tracker.example"] },
      createdAt: now,
      id: "policy-existing",
      updatedAt: now,
      version: 3,
    },
  ]);

  const client = BrowserUseClient("test-key", fixture.url, clock);

  try {
    const id = await createNetworkPolicyResolver(client)();

    expect(id).toBe("policy-existing");
    expect(fixture.createBodies).toHaveLength(0);

    const [patched] = fixture.patchBodies;

    expect(patched?.allow?.domains).toEqual([...CAPTCHA_HOSTS]);
    expect(patched?.block?.domains).not.toContain("stale-tracker.example");
    expect(patched?.block?.domains).toContain("doubleclick.net");
    expect(fixture.policies[0]?.version).toBe(4);
  } finally {
    fixture.close();
  }
});
