import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";
import { request as apiRequest } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
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

const currentResumeSchema = z.object({
  id: z.string(),
  filename: z.string(),
});

function resumeIdFrom(data: string | null) {
  return data?.match(/\/api\/profile\/resume\/(?<id>[^/]+)\/file/u)?.groups?.id ?? null;
}

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

test("a resume download is scoped to the id in the path", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);
  const firstBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));
  const secondBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-board.pdf"));

  const first = uploadSchema.parse(
    await (
      await owner.post("/api/profile/resume", {
        multipart: {
          file: { buffer: Buffer.from(firstBytes), mimeType: "application/pdf", name: "first.pdf" },
        },
      })
    ).json(),
  );

  await owner.post("/api/profile/resume", {
    multipart: {
      file: { buffer: Buffer.from(secondBytes), mimeType: "application/pdf", name: "second.pdf" },
    },
  });

  const firstDownload = await owner.get(`/api/profile/resume/${first.id}/file`);

  expect(firstDownload.status()).toBe(200);
  expect(
    Buffer.from(new Uint8Array(await firstDownload.body())).equals(Buffer.from(firstBytes)),
  ).toBe(true);

  const missing = await owner.get(`/api/profile/resume/${crypto.randomUUID()}/file`);

  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "not_found" });

  const anonymous = await apiRequest.newContext({ baseURL: appServerUrl });

  expect((await anonymous.get(`/api/profile/resume/${first.id}/file`)).status()).toBe(401);

  await anonymous.dispose();
  await owner.dispose();
});

test("a refused resume upload is a 400, not a 500", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const wrongType = await owner.post("/api/profile/resume", {
    multipart: {
      file: { buffer: Buffer.from("not a pdf"), mimeType: "text/plain", name: "resume.txt" },
    },
  });

  expect(wrongType.status()).toBe(400);
  expect(await wrongType.json()).toEqual(expect.objectContaining({ error: "invalid_request" }));

  const missingFile = await owner.post("/api/profile/resume", {
    multipart: { note: "no file attached" },
  });

  expect(missingFile.status()).toBe(400);

  await owner.dispose();
});

test("tier 1 facts are prefilled from the resume and confirmed on Profile", async ({
  identityServer,
}) => {
  const anthropic = await startAnthropicFixtureServer();

  const server = await startFreshAppServer(identityServer, {
    ANTHROPIC_BASE_URL: anthropic.url,
    ANTHROPIC_API_KEY: "test-anthropic-key",
  });

  try {
    const owner = await ownerContextFor(server.url);

    const upload = await owner.post("/api/profile/resume", {
      multipart: {
        file: {
          name: "resume.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        },
      },
    });

    const created = uploadSchema.parse(await upload.json());

    expect(created.parsedWith).toBe("unpdf");
    expect(created.prefilledFacts).toEqual([
      "legal_name",
      "email",
      "phone",
      "current_city",
      "current_country",
      "work_auth",
      "current_employer",
      "degree_highest",
      "languages",
    ]);

    const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

    const resumeFacts = listed.facts.filter((fact) => fact.source === "resume");

    expect(resumeFacts.map((fact) => [fact.key, fact.value])).toEqual([
      ["current_city", "Toronto"],
      ["current_country", "Canada"],
      ["current_employer", "Brightwave Analytics"],
      ["degree_highest", "BSc Computer Science"],
      ["email", "maya.okafor@example.com"],
      ["languages", "English, French"],
      ["legal_name", "Maya Okafor"],
      ["phone", "+1 416 555 0199"],
      ["work_auth", "Canadian citizen"],
    ]);
    expect(resumeFacts.every((fact) => !fact.confirmed)).toBe(true);
    expect(resumeFacts.every((fact) => fact.revision === 1)).toBe(true);

    const email = listed.facts.find((fact) => fact.key === "email");

    expect(email?.confirmed).toBe(false);

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

    const singles = anthropic.singleMessages();

    expect(singles).toHaveLength(1);
    expect(singles[0]?.model).toBe("claude-haiku-5-5");
    expect(singles[0]?.hasDocument).toBe(false);
    expect(singles[0]?.outputFormatType).toBe("json_schema");
    expect(singles[0]?.userText).toContain("Name: Maya Okafor");

    const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
    sqlite.exec("PRAGMA busy_timeout = 5000;");

    const usageRows = sqlite.prepare("select purpose, model, cost_micros from llm_usage").all();

    expect(usageRows).toEqual([
      { cost_micros: expect.any(Number), model: "claude-haiku-5-5", purpose: "resume_facts" },
    ]);
    expect(usageRows.at(0)?.cost_micros).toBeGreaterThan(0);

    sqlite.close();
  } finally {
    await server.stop();
    anthropic.stop();
  }
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
      "work_auth",
      "languages",
    ]);

    const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

    const allScanned = listed.facts.filter((fact) => fact.source === "resume");

    expect(allScanned).toHaveLength(7);
    expect(allScanned.every((fact) => fact.confirmed)).toBe(false);
    expect(allScanned.every((fact) => fact.revision)).toBe(true);

    const singles = anthropic.singleMessages();

    expect(singles).toHaveLength(2);
    expect(singles[0]?.model).toBe("claude-haiku-5-5");
    expect(singles[0]?.hasDocument).toBe(true);
    expect(singles[0]?.pdfBytes).toBeGreaterThan(0);
    expect(singles[1]?.hasDocument).toBe(false);
    expect(singles[1]?.outputFormatType).toBe("json_schema");

    const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
    sqlite.exec("PRAGMA busy_timeout = 5000;");

    const usageRows = sqlite
      .prepare(
        "select purpose, model, input_tokens, output_tokens, cost_micros from llm_usage order by purpose",
      )
      .all();

    expect(usageRows).toHaveLength(2);
    expect(usageRows.map((row) => row.purpose)).toEqual(["resume_facts", "resume_pdf"]);

    const pdfRow = usageRows.find((row) => row.purpose === "resume_pdf");

    expect(pdfRow?.input_tokens).toBe(2006);
    expect(pdfRow?.output_tokens).toBe(92);
    expect(pdfRow?.cost_micros).toBeGreaterThan(0);

    const factsRow = usageRows.find((row) => row.purpose === "resume_facts");

    expect(factsRow?.cost_micros).toBeGreaterThan(0);

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
    expect(created.prefilledFacts).toEqual(["email"]);

    const download = await owner.get(`/api/profile/resume/${created.id}/file`);
    const returned = new Uint8Array(await download.body());

    expect(Buffer.from(returned).equals(pdfBytes)).toBe(true);

    expect(anthropic.singleMessages()).toHaveLength(0);

    const listed = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

    expect(listed.facts.filter((fact) => fact.source === "resume")).toEqual([
      expect.objectContaining({ key: "email", value: "maya.okafor@example.com", confirmed: false }),
    ]);

    const sqlite = new DatabaseSync(server.databasePath, { readOnly: true });
    sqlite.exec("PRAGMA busy_timeout = 5000;");

    const usageRows = sqlite.prepare("select purpose from llm_usage").all();

    expect(usageRows).toHaveLength(0);

    sqlite.close();
  } finally {
    await server.stop();
    anthropic.stop();
  }
});

test("uploading a resume on /profile/resume finishes scanning and settles to PDF verified", async ({
  browser,
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);
  const context = await browser.newContext({ storageState: await owner.storageState() });
  const page = await context.newPage();

  try {
    await page.goto(`${appServerUrl}/profile/resume`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Upload PDF/iu }).waitFor({ state: "visible" });

    await page.locator('#profile-resume input[type="file"]').setInputFiles({
      buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      mimeType: "application/pdf",
      name: "sam-rivera-resume.pdf",
    });

    const scan = page.getByTestId("resume-scan");

    await expect(scan).toBeVisible();
    await expect(page.getByText("PDF verified", { exact: true })).toBeHidden();
    await expect(scan).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText("PDF verified", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Replace resume/iu })).toBeEnabled();
  } finally {
    await owner.dispose();
    await context.close();
  }
});

test("a corrupt PDF is a 400 and the saved resume stays current", async ({
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  try {
    const saved = uploadSchema.parse(
      await (
        await owner.post("/api/profile/resume", {
          multipart: {
            file: {
              buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
              mimeType: "application/pdf",
              name: "kept-resume.pdf",
            },
          },
        })
      ).json(),
    );

    const corrupt = await owner.post("/api/profile/resume", {
      multipart: {
        file: {
          buffer: Buffer.from("%PDF-1.4\nthis is not a real pdf\n%%EOF\n"),
          mimeType: "application/pdf",
          name: "broken.pdf",
        },
      },
    });

    expect(corrupt.status()).toBe(400);
    expect(await corrupt.json()).toEqual(expect.objectContaining({ error: "invalid_request" }));

    const current = currentResumeSchema.parse(
      await (await owner.get("/api/profile/resume")).json(),
    );

    expect(current.id).toBe(saved.id);
    expect(current.filename).toBe("kept-resume.pdf");
  } finally {
    await owner.dispose();
  }
});

test("replacing the resume updates the file and the authenticated preview", async ({
  browser,
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);
  const context = await browser.newContext({ storageState: await owner.storageState() });
  const page = await context.newPage();
  const input = page.locator('#profile-resume input[type="file"]');
  const preview = page.locator('#profile-resume object[type="application/pdf"]');

  try {
    await page.goto(`${appServerUrl}/profile/resume`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Upload PDF/iu }).waitFor({ state: "visible" });

    await input.setInputFiles({
      buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      mimeType: "application/pdf",
      name: "sam-rivera-resume.pdf",
    });

    await expect(page.getByTestId("resume-scan")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText("sam-rivera-resume.pdf", { exact: true }).first()).toBeVisible();
    await expect(preview).toHaveAttribute("data", /\/api\/profile\/resume\/[^/]+\/file/u);

    const firstId = resumeIdFrom(await preview.getAttribute("data"));

    expect(firstId).not.toBeNull();

    await input.setInputFiles({
      buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-board.pdf")),
      mimeType: "application/pdf",
      name: "sam-rivera-board.pdf",
    });

    await expect(page.getByTestId("resume-scan")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText("sam-rivera-board.pdf", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("sam-rivera-resume.pdf", { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => resumeIdFrom(await preview.getAttribute("data")))
      .not.toBe(firstId);
    expect(await preview.getAttribute("data")).not.toContain(`resume/${String(firstId)}/file`);
  } finally {
    await owner.dispose();
    await context.close();
  }
});

test("a failed replace keeps the saved resume and offers a retry", async ({
  browser,
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const saved = uploadSchema.parse(
    await (
      await owner.post("/api/profile/resume", {
        multipart: {
          file: {
            buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
            mimeType: "application/pdf",
            name: "saved-resume.pdf",
          },
        },
      })
    ).json(),
  );

  const context = await browser.newContext({ storageState: await owner.storageState() });
  const page = await context.newPage();

  try {
    await page.goto(`${appServerUrl}/profile/resume`, { waitUntil: "load" });
    await expect(page.getByText("saved-resume.pdf", { exact: true }).first()).toBeVisible();

    await page.locator('#profile-resume input[type="file"]').setInputFiles({
      buffer: Buffer.from("%PDF-1.4\nthis is not a real pdf\n%%EOF\n"),
      mimeType: "application/pdf",
      name: "broken.pdf",
    });

    const failure = page.getByTestId("resume-replace-failed");

    await expect(failure).toBeVisible();
    await expect(failure).toContainText("Your current resume is still saved");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText("saved-resume.pdf", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("broken.pdf", { exact: true })).toHaveCount(0);
    await expect(page.locator('#profile-resume object[type="application/pdf"]')).toHaveAttribute(
      "data",
      new RegExp(`resume/${saved.id}/file`, "u"),
    );

    const current = currentResumeSchema.parse(
      await (await owner.get("/api/profile/resume")).json(),
    );

    expect(current.id).toBe(saved.id);
  } finally {
    await owner.dispose();
    await context.close();
  }
});

test("Saved answers is centred, holds no job-search email card and is axe clean", async ({
  browser,
  isolatedAppServer: { url: appServerUrl },
}) => {
  const owner = await ownerContextFor(appServerUrl);

  const context = await browser.newContext({
    storageState: await owner.storageState(),
    viewport: { height: 1000, width: 1280 },
  });

  const page = await context.newPage();

  try {
    await page.goto(`${appServerUrl}/profile/details`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { level: 1, name: "Saved answers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Key details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Strengthen your profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learned from Reviews" })).toBeVisible();
    await expect(page.getByText("You're all caught up.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Job-search address" })).toHaveCount(0);
    await expect(page.getByText(/^Tier \d/u)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tier 2" })).toHaveCount(0);

    const detailsAxe = await new AxeBuilder({ page }).analyze();

    expect(detailsAxe.violations).toEqual([]);

    await page.goto(`${appServerUrl}/profile/resume`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cover letter", exact: true })).toBeVisible();

    const resumeAxe = await new AxeBuilder({ page }).analyze();

    expect(resumeAxe.violations).toEqual([]);
  } finally {
    await owner.dispose();
    await context.close();
  }
});

const shotDirectory = process.env.PROFILE_SHOT_DIR;

test.describe("Profile screenshots", () => {
  test.skip(shotDirectory === undefined, "only when PROFILE_SHOT_DIR is set");

  for (const width of [390, 1280] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`resume and saved answers at ${String(width)} ${theme}`, async ({
        browser,
        isolatedAppServer: { url: appServerUrl },
      }) => {
        mkdirSync(shotDirectory ?? "", { recursive: true });

        const owner = await ownerContextFor(appServerUrl);

        await owner.post("/api/profile/resume", {
          multipart: {
            file: {
              buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
              mimeType: "application/pdf",
              name: "Maya_Okafor_Resume.pdf",
            },
          },
        });

        const context = await browser.newContext({
          storageState: await owner.storageState(),
          viewport: { height: 860, width },
        });

        const page = await context.newPage();

        await page.addInitScript((mode) => {
          globalThis.localStorage.setItem("overture.theme", mode);
        }, theme);

        try {
          await page.goto(`${appServerUrl}/profile/resume`, { waitUntil: "load" });
          await expect(
            page.getByText("Maya_Okafor_Resume.pdf", { exact: true }).first(),
          ).toBeVisible();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          await page.screenshot({
            fullPage: true,
            path: join(shotDirectory ?? "", `profile-resume-${String(width)}-${theme}.png`),
          });

          await page.goto(`${appServerUrl}/profile/details`, { waitUntil: "load" });
          await expect(page.getByText("You're all caught up.", { exact: true })).toBeVisible();
          await page.screenshot({
            fullPage: true,
            path: join(shotDirectory ?? "", `profile-saved-answers-${String(width)}-${theme}.png`),
          });
        } finally {
          await owner.dispose();
          await context.close();
        }
      });
    }
  }
});
