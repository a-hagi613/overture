import { readFileSync } from "node:fs";

import { DatabaseSync } from "node:sqlite";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test, startFreshAppServer } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const uploadSchema = z.object({
  id: z.string(),
  sha256: z.string().length(64),
  bytes: z.number(),
  pages: z.number(),
  parsedWith: z.enum(["unpdf", "llm"]),
  unreadable: z.boolean(),
  prefilledFacts: z.array(z.string()),
});

const wrappedKeySchema = z.object({ wrapped_dek: z.instanceof(Uint8Array) });

const factsSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      source: z.enum(["resume", "user", "review", "import"]),
      confirmed: z.boolean(),
      revision: z.number(),
    }),
  ),
});

const resumeRowSchema = z.object({
  sha256: z.string(),
  bytes: z.number(),
  is_current: z.number(),
});

export function createObjectStoreStub(root: string) {
  return { root };
}

async function ownerContextFor(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  await owner.get(link);

  const state = await verifyAuthState(appServerUrl, owner);

  expect(state.users.at(-1)?.role).toBe("owner");
  expect(state.sessions).toHaveLength(1);

  return owner;
}

test("an uploaded resume is stored encrypted and retrievable byte for byte", async ({
  isolatedAppServer: { url: appServerUrl, databasePath: appDatabasePath },
}) => {
  const owner = await ownerContextFor(appServerUrl);
  const pdfBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

  const upload = await owner.post("/api/profile/resume", {
    multipart: {
      file: { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfBytes) },
    },
  });

  const created = uploadSchema.parse(await upload.json());

  expect(created.sha256).toBe(
    Buffer.from(await crypto.subtle.digest("SHA-256", pdfBytes)).toString("hex"),
  );
  expect(created.bytes).toBe(pdfBytes.byteLength);
  expect(created.parsedWith).toBe("unpdf");

  const download = await owner.get(`/api/profile/resume/${created.id}/file`);

  const returned = new Uint8Array(await download.body());

  expect(Buffer.from(returned).equals(pdfBytes)).toBe(true);

  const sqlite = new DatabaseSync(appDatabasePath, { readOnly: true });
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  const row = resumeRowSchema.parse(
    sqlite.prepare("select sha256, bytes, is_current from resumes limit 1").get(),
  );

  expect(row.sha256).toBe(created.sha256);
  expect(row.bytes).toBe(pdfBytes.byteLength);

  const wrapped = wrappedKeySchema.parse(
    sqlite.prepare("select wrapped_dek from user_keys limit 1").get(),
  );

  expect(Buffer.from(wrapped.wrapped_dek).length).toBeGreaterThan(32);

  sqlite.close();
});

test("tier 1 facts are prefilled from the resume and confirmed on Profile", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      },
    },
  });

  const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

  const resumeFacts = listed.facts.filter((fact) => fact.source === "resume");

  expect(resumeFacts.map((fact) => fact.key)).toEqual([
    "current_city",
    "current_country",
    "current_employer",
    "degree_highest",
    "email",
    "languages",
    "legal_name",
    "notice_period",
    "phone",
    "salary_expectation",
    "willing_relocate",
    "work_auth",
  ]);

  const email = listed.facts.find((fact) => fact.key === "email");

  expect(email?.value).toBe("maya.okafor@example.com");
  expect(email?.confirmed).toBe(false);
  expect(email?.revision).toBe(1);

  const confirmed = factsSchema.parse(
    await (
      await owner.put("/api/profile/facts", {
        data: { facts: [{ key: "email", value: "maya.okafor+work@example.com" }] },
      })
    ).json(),
  );

  const confirmedEmail = confirmed.facts.find((fact) => fact.key === "email");

  expect(confirmedEmail?.value).toBe("maya.okafor+work@example.com");
  expect(confirmedEmail?.confirmed).toBe(true);
  expect(confirmedEmail?.revision).toBe(2);
  expect(confirmedEmail?.source).toBe("user");
});

test("a scanned resume falls back to the LLM port and a usage row is recorded", async ({
  identityServer,
}) => {
  const anthropic = await startAnthropicFixtureServer();

  const server = await startFreshAppServer(identityServer, {
    ANTHROPIC_BASE_URL: anthropic.url,
    ANTHROPIC_API_KEY: "test-anthropic-key",
  });

  try {
    const owner = await ownerContextFor(server.url);
    const pdfBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-scanned.pdf"));

    const upload = await owner.post("/api/profile/resume", {
      multipart: {
        file: {
          name: "resume-scanned.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(pdfBytes),
        },
      },
    });

    const created = uploadSchema.parse(await upload.json());

    expect(created.parsedWith).toBe("llm");
    expect(created.unreadable).toBe(false);
    expect(created.prefilledFacts).toEqual([
      "legal_name",
      "email",
      "phone",
      "current_city",
      "current_country",
      "notice_period",
      "work_auth",
      "languages",
    ]);

    const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

    const allScanned = listed.facts.filter((fact) => fact.source === "resume");

    expect(allScanned).toHaveLength(8);
    expect(allScanned.every((fact) => fact.confirmed)).toBe(false);
    expect(allScanned.every((fact) => fact.revision)).toBe(true);

    const singles = anthropic.singleMessages();

    expect(singles).toHaveLength(1);
    expect(singles[0]?.model).toBe("claude-haiku-4-5");
    expect(singles[0]?.hasDocument).toBe(true);
    expect(singles[0]?.pdfBytes).toBeGreaterThan(0);

    const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
    sqlite.exec("PRAGMA busy_timeout = 5000;");

    const usageRows = sqlite
      .prepare("select purpose, model, input_tokens, output_tokens, cost_micros from llm_usage")
      .all();

    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]?.purpose).toBe("resume_pdf");
    expect(usageRows[0]?.input_tokens).toBe(2006);
    expect(usageRows[0]?.output_tokens).toBe(92);
    expect(usageRows[0]?.cost_micros).toBeGreaterThan(0);

    sqlite.close();
  } finally {
    await server.stop();
    anthropic.stop();
  }
});

test("over the cap the scanned upload still succeeds but the text stays empty", async ({
  identityServer,
}) => {
  const anthropic = await startAnthropicFixtureServer();

  const server = await startFreshAppServer(identityServer, {
    ANTHROPIC_BASE_URL: anthropic.url,
    ANTHROPIC_API_KEY: "test-anthropic-key",
  });

  try {
    const owner = await ownerContextFor(server.url);
    const pdfBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-scanned.pdf"));

    const capped = await owner.put("/__test__/settings/llm.cap_user_day_usd", {
      data: { value: "0" },
    });

    expect(capped.status()).toBe(200);

    const upload = await owner.post("/api/profile/resume", {
      multipart: {
        file: {
          name: "resume-scanned.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(pdfBytes),
        },
      },
    });

    expect(upload.status()).toBe(201);

    const created = uploadSchema.parse(await upload.json());

    expect(created.bytes).toBe(pdfBytes.byteLength);
    expect(created.parsedWith).toBe("unpdf");
    expect(created.unreadable).toBe(true);
    expect(created.prefilledFacts).toEqual([]);

    const download = await owner.get(`/api/profile/resume/${created.id}/file`);
    const returned = new Uint8Array(await download.body());

    expect(Buffer.from(returned).equals(pdfBytes)).toBe(true);

    expect(anthropic.singleMessages()).toHaveLength(0);

    const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

    expect(listed.facts.filter((fact) => fact.source === "resume")).toHaveLength(0);

    const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
    sqlite.exec("PRAGMA busy_timeout = 5000;");

    const usageRows = sqlite
      .prepare("select purpose from llm_usage where purpose = 'resume_pdf'")
      .all();

    expect(usageRows).toHaveLength(0);

    sqlite.close();
  } finally {
    await server.stop();
    anthropic.stop();
  }
});
