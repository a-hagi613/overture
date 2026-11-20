import { readFileSync } from "node:fs";

import { Database } from "bun:sqlite";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const uploadSchema = z.object({
  id: z.string(),
  sha256: z.string().length(64),
  bytes: z.number(),
  pages: z.number(),
  parsedWith: z.enum(["unpdf", "llm"]),
  prefilledFacts: z.array(z.string()),
});

const wrappedKeySchema = z.object({ wrapped_dek: z.instanceof(Buffer) });

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
  appServerUrl,
  appServer,
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

  const sqlite = new Database(appServer.databasePath, { readonly: true });

  const row = resumeRowSchema.parse(
    sqlite.query("select sha256, bytes, is_current from resumes limit 1").get(),
  );

  expect(row.sha256).toBe(created.sha256);
  expect(row.bytes).toBe(pdfBytes.byteLength);

  const wrapped = wrappedKeySchema.parse(
    sqlite.query("select wrapped_dek from user_keys limit 1").get(),
  );

  expect(Buffer.from(wrapped.wrapped_dek).length).toBeGreaterThan(32);

  sqlite.close();
});

test("tier 1 facts are prefilled from the resume and confirmed on Profile", async ({
  appServerUrl,
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
    "legal_name",
    "email",
    "phone",
    "current_city",
    "current_country",
    "languages",
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
