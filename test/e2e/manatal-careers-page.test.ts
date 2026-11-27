import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const APPLY_PAGE = readFileSync(
  "test/e2e/fixtures/forms/manatal/flexstaf-W3994VR9.apply.page.html",
  "utf8",
);

const FORM_JSON = readFileSync(
  "test/e2e/fixtures/forms/manatal/flexstaf-W3994VR9.send-form.json",
  "utf8",
);

const JOB_PAGE = `<!doctype html>
<html lang="en">
  <head><title>Senior Backend Software Engineer – Golang - Flexstaf IT | Career Page</title></head>
  <body>
    <a href="/flexstaf-it/job/W3994VR9/apply">Apply</a>
  </body>
</html>`;

const applicationSchema = z.object({
  application: z.object({
    status: z.string(),
    statusReason: z.string().nullable(),
  }),
  snapshot: z.object({ answers: z.array(z.object({ label: z.string() })) }).nullable(),
});

const attemptsSchema = z.object({
  attempts: z.array(
    z.object({
      outcome: z.string().nullable(),
      submitClickedAt: z.number().nullable(),
    }),
  ),
});

interface ManatalFixture {
  close: () => void;
  postingUrl: string;
  submissions: () => number;
}

function startManatalFixture() {
  let submissions = 0;

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/api/v1.0/jobs/4611702/application-form/") {
        return new Response(FORM_JSON, { headers: { "content-type": "application/json" } });
      }

      if (url.pathname === "/flexstaf-it/job/W3994VR9") {
        return new Response(JOB_PAGE, { headers: { "content-type": "text/html" } });
      }

      if (url.pathname === "/flexstaf-it/job/W3994VR9/apply") {
        if (request.method === "POST") {
          submissions += 1;
        }

        return new Response(APPLY_PAGE, { headers: { "content-type": "text/html" } });
      }

      return new Response("not found", { status: 404 });
    },
  });

  const baseUrl = server.url.toString().replace(/\/$/u, "");

  return {
    close: () => {
      void server.stop(true);
    },
    postingUrl: `${baseUrl}/flexstaf-it/job/W3994VR9`,
    submissions: () => submissions,
  } satisfies ManatalFixture;
}

async function withHarness(
  identityServer: IdentityServer,
  work: (input: {
    fixture: ManatalFixture;
    owner: APIRequestContext;
    server: AppServer;
    userId: string;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-manatal-careers-"));

  const fixture = startManatalFixture();

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: join(directory, "browsers"),
    OVERTURE_DRY_SUBMIT: "1",
  });

  try {
    const { owner, userId } = await ownerContextFor(server.url);

    await owner.post("/api/running", { data: { running: true } });

    const resume = await owner.post("/api/profile/resume", {
      multipart: {
        file: {
          buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
          mimeType: "application/pdf",
          name: "maya-okafor.pdf",
        },
      },
    });

    expect(resume.ok()).toBe(true);

    const facts = await owner.put("/api/profile/facts", {
      data: {
        facts: [
          { key: "legal_name", value: "Maya Okafor", scope: "" },
          { key: "email", value: "maya.okafor@example.com", scope: "" },
          { key: "phone", value: "+1 415 555 0199", scope: "" },
        ],
      },
    });

    expect(facts.ok()).toBe(true);

    await work({ fixture, owner, server, userId });
  } finally {
    await server.stop();
    fixture.close();
  }
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind, payload },
    timeout: 120_000,
  });

  if (!response.ok()) {
    throw new Error(
      `The ${kind} job failed: ${String(response.status())} ${await response.text()}`,
    );
  }
}

test("a real Freehire Manatal posting prepares, fills and stops at the dry-submit gate", async ({
  identityServer,
}) => {
  await withHarness(identityServer, async ({ fixture, owner, userId }) => {
    const companyId = await seedCompany(owner, "Flexstaf IT", "flexstaf.example");
    const boardId = await seedBoard(owner, companyId, "manatal", "flexstaf-it-plan");

    const postingId = await seedPosting(owner, {
      ats: "manatal",
      atsJobId: "W3994VR9",
      boardId,
      companyId,
      title: "Senior Backend Software Engineer – Golang",
      url: fixture.postingUrl,
    });

    const applicationId = await seedApplication(owner, {
      postingId,
      status: "preparing",
      userId,
    });

    await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));

    const prepared = applicationSchema.parse(
      await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
    );

    expect(prepared.application.status).toBe("ready");
    expect(prepared.application.statusReason).toBeNull();

    await grantApplications(owner, 2);
    await approveApplication(owner, applicationId);

    await runJob(owner, "application.send", JSON.stringify({ applicationId }));

    const sent = applicationSchema.parse(
      await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
    );

    expect(sent.application.status).toBe("ready");
    expect(sent.application.statusReason).toBeNull();

    const { attempts } = attemptsSchema.parse(
      await (
        await owner.get(`/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`)
      ).json(),
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: "dry_submit", submitClickedAt: null });
    expect(fixture.submissions()).toBe(0);
  });
});
