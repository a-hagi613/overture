import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import {
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const FORMS = join(process.cwd(), "test/e2e/fixtures/forms");

const LEVER_JOB_ID = "46a2b956-a8e4-4b91-a404-08121e10bb62";

const ASHBY_JOB_ID = "0a278229-474e-4534-82d0-ebfafe18ad9d";

const LOGIN_WALL_JOB_ID = "c4f1c0d2-6b7a-4c3e-9d10-3f4c2b8e7a11";

const AUTOFILL_JOB_ID = "9f7e2d31-0a4b-4f68-8c25-51d0b4e6f212";

const HIVE_FORM = readFileSync(join(FORMS, "lever", `hive-${LEVER_JOB_ID}.fixture.html`), "utf8");

const SIGN_IN_PAGE = readFileSync(join(FORMS, "login-wall", "sign-in.html"), "utf8");

const GUEST_FORM_PAGE = readFileSync(join(FORMS, "login-wall", "lever-guest-form.html"), "utf8");

const CLERA_FORM = readFileSync(join(FORMS, "ashby", `clera-${ASHBY_JOB_ID}.form.json`), "utf8");

const RESUME = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const FACTS = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+1 416 555 0199", scope: "" },
  { key: "current_city", value: "London", scope: "" },
  { key: "current_country", value: "United Kingdom", scope: "" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor", scope: "" },
  { key: "work_auth", value: "Yes", scope: "US" },
  { key: "sponsorship_required", value: "No", scope: "US" },
];

interface FormFixtureServer {
  url: string;
  gatedReads: () => number;
  leverReads: () => number;
  ashbyReads: () => { boardToken: string; jobPostingId: string }[];
  stop: () => void;
}

function startFormFixtureServer() {
  let leverReads = 0;
  let gatedReads = 0;
  const ashbyReads: { boardToken: string; jobPostingId: string }[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/api/non-user-graphql") {
        if (url.searchParams.get("op") !== "ApiJobPosting" || request.method !== "POST") {
          return new Response(null, { status: 404 });
        }

        const body = z
          .object({
            variables: z.object({
              jobPostingId: z.string(),
              organizationHostedJobsPageName: z.string(),
            }),
          })
          .parse(await request.json());

        ashbyReads.push({
          boardToken: body.variables.organizationHostedJobsPageName,
          jobPostingId: body.variables.jobPostingId,
        });

        return new Response(CLERA_FORM, { headers: { "content-type": "application/json" } });
      }

      if (/^\/hive\/[^/]+\/apply$/u.test(url.pathname)) {
        leverReads += 1;

        return new Response(HIVE_FORM, { headers: { "content-type": "text/html" } });
      }

      if (/^\/gated\/[^/]+\/apply$/u.test(url.pathname)) {
        gatedReads += 1;

        if (url.pathname.includes(LOGIN_WALL_JOB_ID)) {
          return new Response(null, {
            headers: { location: `/login?returnUrl=${encodeURIComponent(url.pathname)}` },
            status: 302,
          });
        }

        return new Response(GUEST_FORM_PAGE, { headers: { "content-type": "text/html" } });
      }

      if (url.pathname === "/login") {
        return new Response(SIGN_IN_PAGE, { headers: { "content-type": "text/html" } });
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    ashbyReads: () => ashbyReads,
    gatedReads: () => gatedReads,
    leverReads: () => leverReads,
    stop: () => {
      void server.stop(true);
    },
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies FormFixtureServer;
}

const answersSchema = z.object({
  answers: z.array(
    z.object({
      text: z.string(),
      answer: z.string().nullable(),
      resolved: z.boolean(),
      block: z.string().nullable(),
    }),
  ),
});

const reviewsSchema = z.object({
  reviews: z.array(z.object({ id: z.string(), prompt: z.string(), unlocked: z.number() })),
});

const planCacheSchema = z.object({
  plans: z.array(
    z.object({
      ats: z.string(),
      failures: z.number(),
      formSignature: z.string(),
      hits: z.number(),
      questions: z.number(),
      readPath: z.string().nullable(),
    }),
  ),
});

const applicationSchema = z.object({
  application: z.object({ status: z.string(), statusReason: z.string().nullable() }),
});

const attemptsSchema = z.object({
  attempts: z.array(z.object({ id: z.string(), outcome: z.string().nullable() })),
});

const billingStateSchema = z.object({
  applicationsLeft: z.number(),
  ledger: z.array(z.object({ kind: z.string() })),
});

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", { data: { kind, payload } });

  expect(response.ok()).toBe(true);
}

async function prepare(owner: APIRequestContext, applicationId: string) {
  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));
}

async function applicationStatus(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`);

  return applicationSchema.parse(await response.json()).application;
}

async function answersFor(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/prepared-answers?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return answersSchema.parse(await response.json()).answers;
}

async function planCache(owner: APIRequestContext) {
  const response = await owner.get("/__test__/plan-cache");

  return planCacheSchema.parse(await response.json()).plans;
}

async function prepareProfile(owner: APIRequestContext) {
  const resume = await owner.post("/api/profile/resume", {
    multipart: {
      file: { buffer: Buffer.from(RESUME), mimeType: "application/pdf", name: "resume.pdf" },
    },
  });

  expect(resume.ok()).toBe(true);

  const saved = await owner.put("/api/profile/facts", { data: { facts: FACTS } });

  expect(saved.ok()).toBe(true);
}

async function seedHive(owner: APIRequestContext, fixture: FormFixtureServer) {
  const companyId = await seedCompany(owner, "Hive", "hive.example");
  const boardId = await seedBoard(owner, companyId, "lever", "hive");

  await seedPosting(owner, {
    ats: "lever",
    atsJobId: "mapping-questions",
    boardId,
    companyId,
    questions: [
      {
        answerKind: "fact",
        factKey: "security_clearance",
        fieldType: "text",
        mappedBy: "owner",
        required: true,
        text: "What is/was your GPA?",
      },
      {
        answerKind: "fact",
        factKey: "years_total",
        fieldType: "multiselect",
        mappedBy: "owner",
        options: [
          "Friend",
          "Recruiter/current employee",
          "School job posting/career fair",
          "LinkedIn",
          "AngelList",
          "Advertisement (e.g. billboard)",
          "Online article/press",
          "Other",
        ],
        required: true,
        text: "How did you hear about us?",
      },
      {
        answerKind: "fact",
        factKey: "current_employer",
        fieldType: "text",
        mappedBy: "owner",
        required: false,
        text: "Current company",
      },
      {
        answerKind: "skip",
        fieldType: "textarea",
        mappedBy: "owner",
        required: false,
        text: "If Other, please specify:",
      },
      {
        answerKind: "fact",
        factKey: "website_url",
        fieldType: "text",
        mappedBy: "owner",
        required: false,
        text: "Twitter URL",
      },
    ],
    title: "Mapping questions",
    url: "https://fixture.invalid/mapping-questions",
  });

  async function posting(jobId: string) {
    return seedPosting(owner, {
      ats: "lever",
      atsJobId: jobId,
      boardId,
      companyId,
      title: "Senior Product Designer",
      url: `${fixture.url}/hive/${jobId}/apply`,
    });
  }

  return { companyId, posting };
}

async function seedClera(owner: APIRequestContext, fixture: FormFixtureServer) {
  const companyId = await seedCompany(owner, "Clera", "clera.example");
  const boardId = await seedBoard(owner, companyId, "ashby", "clera");

  return seedPosting(owner, {
    ats: "ashby",
    atsJobId: ASHBY_JOB_ID,
    boardId,
    companyId,
    countryCode: "US",
    title: "Werkstudent Content & Brand (m/w/d)",
    url: `${fixture.url}/clera/${ASHBY_JOB_ID}/application`,
  });
}

async function seedGated(owner: APIRequestContext, fixture: FormFixtureServer) {
  const companyId = await seedCompany(owner, "Gated Co", "gated.example");
  const boardId = await seedBoard(owner, companyId, "lever", "gated");

  async function posting(jobId: string) {
    return seedPosting(owner, {
      ats: "lever",
      atsJobId: jobId,
      boardId,
      companyId,
      title: "Senior Product Designer",
      url: `${fixture.url}/gated/${jobId}/apply`,
    });
  }

  return { companyId, posting };
}

appTest.describe("reading Lever and Ashby forms in preparation", () => {
  appTest(
    "reads a Lever form over plain HTTP, plans every answer, and reuses the cached plan",
    async ({ identityServer }) => {
      const fixture = startFormFixtureServer();
      const anthropic = await startAnthropicFixtureServer();

      let server: AppServer | null = null;

      try {
        server = await startFreshAppServer(identityServer, {
          ANTHROPIC_API_KEY: "test-anthropic-key",
          ANTHROPIC_BASE_URL: anthropic.url,
          ASHBY_JOBS_BASE_URL: fixture.url,
          LEVER_JOBS_BASE_URL: fixture.url,
        });

        const { owner, userId } = await ownerContextFor(server.url);

        await prepareProfile(owner);

        const hive = await seedHive(owner, fixture);
        const postingId = await hive.posting(LEVER_JOB_ID);

        const applicationId = await seedApplication(owner, {
          postingId,
          status: "preparing",
          userId,
        });

        await prepare(owner, applicationId);

        expect(fixture.leverReads()).toBe(1);

        const reviewed = await applicationStatus(owner, applicationId);

        expect(reviewed.status).toBe("needs_review");

        const planned = await answersFor(owner, applicationId);
        const byPrompt = new Map(planned.map((answer) => [answer.text, answer]));

        expect(byPrompt.get("Full name")?.answer).toBe("Maya Okafor");
        expect(byPrompt.get("Email")?.answer).toBe("maya.okafor@example.com");
        expect(byPrompt.get("Current location")?.answer).toBe("London");
        expect(byPrompt.get("LinkedIn URL")?.answer).toBe(
          "https://www.linkedin.com/in/maya-okafor",
        );
        expect(byPrompt.get("What is/was your GPA?")?.resolved).toBe(false);
        expect(byPrompt.get("How did you hear about us?")?.resolved).toBe(false);

        const reviews = reviewsSchema.parse(await (await owner.get("/api/reviews")).json());

        const gpa = reviews.reviews.find((review) => review.prompt === "What is/was your GPA?");

        const heard = reviews.reviews.find(
          (review) => review.prompt === "How did you hear about us?",
        );

        expect(gpa).toBeDefined();
        expect(heard).toBeDefined();

        const answeredGpa = await owner.post(`/api/reviews/${gpa?.id ?? ""}/answer`, {
          data: { value: "Bachelor's" },
        });

        const answeredHeard = await owner.post(`/api/reviews/${heard?.id ?? ""}/answer`, {
          data: { value: "LinkedIn" },
        });

        expect(answeredGpa.ok()).toBe(true);
        expect(answeredHeard.ok()).toBe(true);

        const ready = await applicationStatus(owner, applicationId);

        expect(ready.status).toBe("ready");

        const readyAnswers = await answersFor(owner, applicationId);
        const readyByPrompt = new Map(readyAnswers.map((answer) => [answer.text, answer]));

        expect(readyByPrompt.get("What is/was your GPA?")?.answer).toBe("Bachelor's");
        expect(readyByPrompt.get("How did you hear about us?")?.answer).toBe("LinkedIn");

        const firstPlan = (await planCache(owner)).find((plan) => plan.ats === "lever");

        expect(firstPlan?.readPath).toBe("lever_html");
        expect(firstPlan?.questions).toBe(14);
        expect(firstPlan?.hits).toBe(0);
        expect(fixture.leverReads()).toBe(1);

        const secondPostingId = await hive.posting("6ff9a2e1-7b30-4f3a-9e9b-2a3f44f1c001");

        const secondApplicationId = await seedApplication(owner, {
          postingId: secondPostingId,
          status: "preparing",
          userId,
        });

        await prepare(owner, secondApplicationId);

        expect(fixture.leverReads()).toBe(2);

        const secondStatus = await applicationStatus(owner, secondApplicationId);

        expect(secondStatus.status).toBe("ready");

        const secondAnswers = await answersFor(owner, secondApplicationId);
        const secondByPrompt = new Map(secondAnswers.map((answer) => [answer.text, answer]));

        expect(secondByPrompt.get("How did you hear about us?")?.answer).toBe("LinkedIn");

        const cachedPlan = (await planCache(owner)).find((plan) => plan.ats === "lever");

        expect(cachedPlan?.hits).toBe(1);
        expect(cachedPlan?.failures).toBe(0);
        expect(anthropic.batchesCreated()).toBe(0);
        expect(anthropic.singleMessages().filter((message) => message.hasDocument)).toHaveLength(0);
      } finally {
        await server?.stop();
        anthropic.stop();
        fixture.stop();
      }
    },
  );

  appTest(
    "reads an Ashby form from the public posting GraphQL endpoint",
    async ({ identityServer }) => {
      const fixture = startFormFixtureServer();
      const anthropic = await startAnthropicFixtureServer();

      let server: AppServer | null = null;

      try {
        server = await startFreshAppServer(identityServer, {
          ANTHROPIC_API_KEY: "test-anthropic-key",
          ANTHROPIC_BASE_URL: anthropic.url,
          ASHBY_JOBS_BASE_URL: fixture.url,
          LEVER_JOBS_BASE_URL: fixture.url,
        });

        const { owner, userId } = await ownerContextFor(server.url);

        await prepareProfile(owner);

        const postingId = await seedClera(owner, fixture);

        const applicationId = await seedApplication(owner, {
          postingId,
          status: "preparing",
          userId,
        });

        await prepare(owner, applicationId);

        expect(fixture.leverReads()).toBe(0);
        expect(fixture.ashbyReads()).toEqual([{ boardToken: "clera", jobPostingId: ASHBY_JOB_ID }]);

        const prepared = await applicationStatus(owner, applicationId);

        expect(prepared.status).toBe("ready");

        const answers = await answersFor(owner, applicationId);
        const byPrompt = new Map(answers.map((answer) => [answer.text, answer]));

        expect(byPrompt.get("Name")?.answer).toBe("Maya Okafor");
        expect(byPrompt.get("Email")?.answer).toBe("maya.okafor@example.com");
        expect(byPrompt.get("LinkedIn")?.answer).toBe("https://www.linkedin.com/in/maya-okafor");
        expect(
          byPrompt.get("Do you have work authorization to work in that country?")?.answer,
        ).toBe("Yes");

        const plan = (await planCache(owner)).find((entry) => entry.ats === "ashby");

        expect(plan?.readPath).toBe("ashby_graphql");
        expect(plan?.questions).toBe(4);
        expect(plan?.hits).toBe(0);
        expect(anthropic.batchesCreated()).toBe(0);
        expect(anthropic.singleMessages().filter((message) => message.hasDocument)).toHaveLength(0);
      } finally {
        await server?.stop();
        anthropic.stop();
        fixture.stop();
      }
    },
  );
});

appTest.describe("the login-wall pre-flight in preparation", () => {
  appTest(
    "skips a posting behind a mandatory login wall without spending an Application",
    async ({ identityServer }) => {
      const fixture = startFormFixtureServer();
      const anthropic = await startAnthropicFixtureServer();

      let server: AppServer | null = null;

      try {
        server = await startFreshAppServer(identityServer, {
          ANTHROPIC_API_KEY: "test-anthropic-key",
          ANTHROPIC_BASE_URL: anthropic.url,
          LEVER_JOBS_BASE_URL: fixture.url,
        });

        const { owner, userId } = await ownerContextFor(server.url);

        await grantApplications(owner, 3);
        await prepareProfile(owner);

        const gated = await seedGated(owner, fixture);
        const postingId = await gated.posting(LOGIN_WALL_JOB_ID);

        const applicationId = await seedApplication(owner, {
          postingId,
          status: "preparing",
          userId,
        });

        await prepare(owner, applicationId);

        expect(fixture.gatedReads()).toBe(1);

        const skipped = await applicationStatus(owner, applicationId);

        expect(skipped).toEqual({
          status: "skipped",
          statusReason: "unsupported_login_required",
        });

        const attempts = attemptsSchema.parse(
          await (
            await owner.get(`/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`)
          ).json(),
        );

        expect(attempts.attempts).toHaveLength(0);

        const billing = billingStateSchema.parse(
          await (
            await owner.get(`/__test__/billing-state?userId=${encodeURIComponent(userId)}`)
          ).json(),
        );

        expect(billing.applicationsLeft).toBe(3);
        expect(billing.ledger.map((entry) => entry.kind)).toEqual(["grant"]);

        expect((await planCache(owner)).filter((plan) => plan.ats === "lever")).toHaveLength(0);
        expect(anthropic.batchesCreated()).toBe(0);
        expect(anthropic.singleMessages().filter((message) => message.hasDocument)).toHaveLength(0);
      } finally {
        await server?.stop();
        anthropic.stop();
        fixture.stop();
      }
    },
  );

  appTest(
    "prepares a guest form that only offers an optional sign-in to autofill",
    async ({ identityServer }) => {
      const fixture = startFormFixtureServer();
      const anthropic = await startAnthropicFixtureServer();

      let server: AppServer | null = null;

      try {
        server = await startFreshAppServer(identityServer, {
          ANTHROPIC_API_KEY: "test-anthropic-key",
          ANTHROPIC_BASE_URL: anthropic.url,
          LEVER_JOBS_BASE_URL: fixture.url,
        });

        const { owner, userId } = await ownerContextFor(server.url);

        await grantApplications(owner, 3);
        await prepareProfile(owner);

        const gated = await seedGated(owner, fixture);
        const postingId = await gated.posting(AUTOFILL_JOB_ID);

        const applicationId = await seedApplication(owner, {
          postingId,
          status: "preparing",
          userId,
        });

        await prepare(owner, applicationId);

        expect(fixture.gatedReads()).toBe(1);

        const prepared = await applicationStatus(owner, applicationId);

        expect(prepared).toEqual({ status: "ready", statusReason: null });

        const answers = await answersFor(owner, applicationId);
        const byPrompt = new Map(answers.map((answer) => [answer.text, answer]));

        expect(byPrompt.get("Full name")?.answer).toBe("Maya Okafor");
        expect(byPrompt.get("Email")?.answer).toBe("maya.okafor@example.com");
        expect(byPrompt.get("Phone")?.resolved).toBe(true);
        expect(byPrompt.get("Current location")?.answer).toBe("London");
        expect(byPrompt.get("LinkedIn URL")?.answer).toBe(
          "https://www.linkedin.com/in/maya-okafor",
        );

        const plan = (await planCache(owner)).find((entry) => entry.ats === "lever");

        expect(plan?.readPath).toBe("lever_html");
        expect(plan?.questions).toBe(5);

        const billing = billingStateSchema.parse(
          await (
            await owner.get(`/__test__/billing-state?userId=${encodeURIComponent(userId)}`)
          ).json(),
        );

        expect(billing.applicationsLeft).toBe(3);
        expect(billing.ledger.map((entry) => entry.kind)).toEqual(["grant"]);
        expect(anthropic.batchesCreated()).toBe(0);
        expect(anthropic.singleMessages().filter((message) => message.hasDocument)).toHaveLength(0);
      } finally {
        await server?.stop();
        anthropic.stop();
        fixture.stop();
      }
    },
  );
});
