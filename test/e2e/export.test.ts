import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { downloadArchive } from "./export-archive.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{ exportServer: AppServer }>({
  exportServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, { JOBS_AUTORUN: "false" });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const referenceNow = Date.UTC(2026, 10, 21, 12, 12, 0);
const DAY_MS = 24 * 60 * 60_000;

const exportStateSchema = z.object({
  downloadUrl: z.string().nullable(),
  expiresAt: z.number().nullable(),
  id: z.string().nullable(),
  readyAt: z.number().nullable(),
  requestedAt: z.number().nullable(),
  status: z.enum(["none", "preparing", "ready", "expired", "failed"]),
});

const exportRowsSchema = z.object({
  exports: z.array(
    z.object({
      expiresAt: z.number().nullable(),
      id: z.string(),
      objectKey: z.string().nullable(),
      readyAt: z.number().nullable(),
      requestedAt: z.number(),
      status: z.string(),
    }),
  ),
});

const createdSchema = z.object({ id: z.string() });

const objectKeysSchema = z.object({ keys: z.array(z.string()) });

const sinkMailSchema = z.object({
  messages: z.array(z.object({ body: z.string(), subject: z.string(), to: z.string() })),
});

const mailUsageSchema = z.object({ notice: z.number() });

async function noticeSends(owner: APIRequestContext) {
  return mailUsageSchema.parse(await (await owner.get("/__test__/mail/usage")).json()).notice;
}

async function exportRowsFor(owner: APIRequestContext, userId: string) {
  const path = `/__test__/account/exports?userId=${encodeURIComponent(userId)}`;
  const rows = exportRowsSchema.parse(await (await owner.get(path)).json());

  return { path, rows };
}

async function moveClock(request: APIRequestContext, target: number) {
  const clock = z
    .object({ now: z.number(), offsetMs: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - (clock.now - clock.offsetMs) },
  });

  expect(moved.ok()).toBe(true);
}

async function seedOwner(owner: APIRequestContext) {
  const paused = await owner.put("/__test__/settings/jobs.poll_interval_ms", {
    data: { value: "3600000" },
  });

  expect(paused.ok()).toBe(true);

  const named = await owner.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  expect(named.ok()).toBe(true);

  await moveClock(owner, referenceNow);

  const resume = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "maya-okafor-resume.pdf",
      },
    },
  });

  expect(resume.ok()).toBe(true);

  const facts = await owner.put("/api/profile/facts", {
    data: {
      facts: [
        { key: "legal_name", scope: "", value: "Maya Okafor" },
        { key: "phone", scope: "", value: "+1 416 555 0134" },
        { key: "work_auth", scope: "CA", value: "Authorized to work in Canada" },
      ],
    },
  });

  expect(facts.ok()).toBe(true);

  const targets = await owner.put("/api/profile/targets", {
    data: {
      employmentTypes: ["full_time"],
      locations: ["Toronto, ON"],
      roles: ["Platform Engineer"],
      salaryCurrency: "CAD",
      salaryFloorMinor: 14_000_000,
      salaryPeriod: "year",
      seniorities: ["senior"],
      workplaces: ["remote"],
    },
  });

  expect(targets.ok()).toBe(true);

  const skips = await owner.put("/api/profile/skip-companies", {
    data: { companies: [{ domain: null, name: "Quillon Payments" }] },
  });

  expect(skips.ok()).toBe(true);
}

async function seedSentApplication(owner: APIRequestContext, userId: string) {
  const companyId = await seedCompany(owner, "Northwind Labs", "northwind.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "export-seed");

  const postingId = await seedPosting(owner, {
    atsJobId: "export-seed-1",
    boardId,
    companyId,
    title: "Senior Platform Engineer",
    url: "https://northwind.example/jobs/1",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    sentAt: referenceNow,
    status: "sent",
    userId,
  });

  const snapshot = await owner.post("/__test__/snapshots/seed", {
    data: {
      answers: [
        {
          answer: "Maya Okafor",
          by_user: false,
          fact_key: "legal_name",
          fact_revision: 1,
          kind: "fact",
          label: "Full name",
          question_id: null,
        },
      ],
      applicationId,
      coverLetter: [{ by_user: false, sentence: "I have run platform teams for eight years." }],
    },
  });

  expect(snapshot.ok()).toBe(true);

  return { applicationId, postingId };
}

async function seedMail(owner: APIRequestContext, userId: string, text: string, marker: string) {
  const seeded = await owner.post("/__test__/mail/seed", {
    data: {
      attachments: [
        {
          filename: `${marker}-schedule.pdf`,
          mime: "application/pdf",
          text: `${marker} attachment body`,
        },
      ],
      classification: "interview",
      from: "Greenhouse <no-reply@us.greenhouse-mail.io>",
      senderDomain: "us.greenhouse-mail.io",
      subject: `Your application with ${marker}`,
      text,
      userId,
    },
  });

  expect(seeded.ok()).toBe(true);
}

async function runJobs(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-due");

  expect(response.ok()).toBe(true);
}

async function runEraseJob(owner: APIRequestContext, userId: string) {
  return owner.post("/__test__/jobs/run-now", {
    data: { kind: "account.erase", payload: JSON.stringify({ userId }) },
  });
}

async function waitForReady(owner: APIRequestContext) {
  await expect
    .poll(
      async () => {
        await runJobs(owner);

        return exportStateSchema.parse(await (await owner.get("/api/account/export")).json())
          .status;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
}

function pathOf(downloadUrl: string) {
  return downloadUrl.slice(0, downloadUrl.indexOf("#"));
}

const CENTRAL_DIRECTORY = 0x02_01_4b_50;

function zipEntry(archive: Uint8Array, entry: string) {
  const buffer = Buffer.from(archive);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  if (end === -1) {
    throw new Error("The download is not a zip archive.");
  }

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY) {
      throw new Error("The zip central directory is malformed.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === entry) {
      const localName = buffer.readUInt16LE(localOffset + 26);
      const localExtra = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const data = buffer.subarray(start, start + compressed);

      if (method === 0) {
        return data;
      }

      if (method === 8) {
        return inflateRawSync(data);
      }

      throw new Error(`The zip entry ${entry} uses an unknown compression method.`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`The zip has no entry ${entry}.`);
}

function unzipJson<T>(archive: Uint8Array, entry: string, schema: z.ZodType<T>) {
  return schema.parse(JSON.parse(new TextDecoder().decode(zipEntry(archive, entry))));
}

async function openExportPage(page: Page, appServerUrl: string) {
  await page.goto(`${appServerUrl}/profile/account#account-data`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Account Settings");
}

test("an export holds only its user's data and downloads from its page", async ({
  browser,
  exportServer,
}) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  const noticesBefore = await noticeSends(owner);

  await seedOwner(owner);
  const { applicationId, postingId } = await seedSentApplication(owner, userId);
  await seedMail(owner, userId, "Your interview is on Tuesday.", "northwind");

  const otherResponse = await owner.post("/__test__/users", {
    data: { email: "other.person@example.com", name: "Other Person" },
  });

  const otherUserId = createdSchema.parse(await otherResponse.json()).id;

  await seedMail(owner, otherUserId, "A private note for another person.", "other");

  const otherFacts = await owner.post("/__test__/facts/seed", {
    data: {
      facts: [{ key: "phone", value: "+1 999 000 0000" }],
      userId: otherUserId,
    },
  });

  expect(otherFacts.ok()).toBe(true);

  await seedApplication(owner, {
    postingId,
    sentAt: referenceNow,
    status: "sent",
    userId: otherUserId,
  });

  const storageState = await owner.storageState();
  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await openExportPage(page, exportServer.url);

  const axe = await new AxeBuilder({ page }).analyze();

  expect(axe.violations).toEqual([]);

  await page.getByRole("button", { name: "Export data" }).click();
  await expect(page.getByRole("heading", { name: "Request" })).toHaveCount(0);

  await waitForReady(owner);

  await expect(page.getByRole("button", { name: "Download export" })).toBeVisible({
    timeout: 10_000,
  });

  const state = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());

  expect(state.downloadUrl).not.toBeNull();

  const cipher = await owner.get(pathOf(state.downloadUrl ?? ""));
  const cipherBytes = await cipher.body();

  expect(cipher.status()).toBe(200);
  expect(cipherBytes.toString("latin1")).not.toContain("Your interview is on Tuesday.");

  const downloadPromise = page.waitForEvent("download");

  await page.getByRole("button", { name: "Download export" }).click();

  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("overture-export.zip");

  const archive = readFileSync(await download.path());

  const profile = unzipJson(
    archive,
    "profile.json",
    z.object({
      mailbox: z.object({ address: z.string() }).nullable(),
      skipCompanies: z.array(z.object({ name: z.string() })),
      targets: z.object({ roles: z.array(z.string()) }).nullable(),
      user: z.object({ email: z.string(), name: z.string() }),
    }),
  );

  expect(profile.user.email).toBe(authTestIdentity.ownerEmail);
  expect(profile.targets?.roles).toEqual(["Platform Engineer"]);
  expect(profile.skipCompanies.map((company) => company.name)).toEqual([
    "Brightwave Analytics",
    "Quillon Payments",
  ]);

  const facts = unzipJson(
    archive,
    "facts.json",
    z.array(z.object({ key: z.string(), value: z.string() })),
  );

  expect(facts.map((fact) => fact.value)).toContain("+1 416 555 0134");
  expect(facts.map((fact) => fact.value)).not.toContain("+1 999 000 0000");

  const applications = unzipJson(
    archive,
    "applications.json",
    z.array(z.object({ company: z.string().nullable(), id: z.string() })),
  );

  expect(applications.map((application) => application.id)).toEqual([applicationId]);

  const snapshots = unzipJson(
    archive,
    "snapshots.json",
    z.array(z.object({ applicationId: z.string(), coverLetter: z.array(z.unknown()).nullable() })),
  );

  expect(snapshots[0]?.applicationId).toBe(applicationId);
  expect(snapshots[0]?.coverLetter).toHaveLength(1);

  const messages = unzipJson(
    archive,
    "messages.json",
    z.array(
      z.object({
        messages: z.array(
          z.object({
            attachments: z.array(
              z.object({ file: z.string(), filename: z.string(), mime: z.string() }),
            ),
            text: z.string(),
          }),
        ),
      }),
    ),
  );

  const message = messages.find((thread) =>
    thread.messages[0]?.text.includes("Your interview is on Tuesday."),
  );

  expect(message).toBeDefined();
  expect(message?.messages[0]?.attachments[0]?.filename).toBe("northwind-schedule.pdf");

  const attachment = zipEntry(archive, message?.messages[0]?.attachments[0]?.file ?? "");

  expect(new TextDecoder().decode(attachment)).toBe("northwind attachment body");

  const resumes = unzipJson(
    archive,
    "resumes.json",
    z.array(z.object({ bytes: z.number(), file: z.string(), filename: z.string() })),
  );

  expect(resumes[0]?.filename).toBe("maya-okafor-resume.pdf");
  expect(
    Buffer.from(zipEntry(archive, resumes[0]?.file ?? "")).equals(
      readFileSync("test/e2e/fixtures/resume-text.pdf"),
    ),
  ).toBe(true);

  const raw = new TextDecoder("latin1").decode(archive);

  expect(raw).not.toContain("other.person@example.com");
  expect(raw).not.toContain("A private note for another person.");
  expect(raw).not.toContain("+1 999 000 0000");

  await runJobs(owner);

  const mail = sinkMailSchema.parse(await (await owner.get("/__test__/mail")).json());
  const readyMail = mail.messages.find((sent) => sent.subject === "Your Overture export is ready");

  expect(readyMail?.to).toBe(authTestIdentity.ownerEmail);
  expect(readyMail?.body).toContain("/profile/account");
  expect((await noticeSends(owner)) - noticesBefore).toBe(1);

  await context.close();
  await owner.dispose();
});

test("a plain-text event detail is exported as text without breaking the build", async ({
  exportServer,
}) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);
  const { applicationId } = await seedSentApplication(owner, userId);

  const plainDetail = "This posting closed before sending.";

  const seeded = await owner.post("/__test__/applications/events/seed", {
    data: {
      applicationId,
      events: [
        {
          at: referenceNow + 1000,
          detail: plainDetail,
          fromValue: "ready",
          kind: "status",
          source: "system",
          toValue: "skipped",
        },
      ],
    },
  });

  expect(seeded.ok()).toBe(true);

  const requested = await owner.post("/api/account/export");

  expect(requested.status()).toBe(202);

  await waitForReady(owner);

  const state = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());

  expect(state.downloadUrl).not.toBeNull();

  const archive = await downloadArchive(owner, state.downloadUrl ?? "");

  const applications = unzipJson(
    archive,
    "applications.json",
    z.array(
      z.object({
        events: z.array(z.object({ detail: z.unknown(), kind: z.string() })),
        id: z.string(),
      }),
    ),
  );

  const application = applications.find((row) => row.id === applicationId);

  expect(application?.events.some((event) => event.detail === plainDetail)).toBe(true);

  await owner.dispose();
});

test("an erase racing an export build leaves no export objects behind", async ({
  exportServer,
}) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);

  const bulk = await owner.post("/__test__/mail/bulk", {
    data: { bodyBytes: 256 * 1024, count: 120, userId },
  });

  expect(bulk.ok()).toBe(true);

  const requested = await owner.post("/api/account/export");

  expect(requested.status()).toBe(202);

  const { path: rowsPath, rows } = await exportRowsFor(owner, userId);
  const exportId = rows.exports.find((row) => row.status === "preparing")?.id;

  expect(exportId).toBeDefined();

  const [build, erase] = await Promise.all([
    owner.post("/__test__/jobs/run-now", {
      data: { kind: "export.build", payload: JSON.stringify({ exportId }) },
    }),
    runEraseJob(owner, userId),
  ]);

  expect(build.ok()).toBe(true);

  const eraseConfirmed = erase.ok() ? erase : await runEraseJob(owner, userId);

  expect(eraseConfirmed.ok()).toBe(true);

  const keyLists = await Promise.all(
    [`files/${userId}/`, `exports/${userId}/`].map(async (prefix) => {
      const response = await owner.get(`/__test__/objects?prefix=${encodeURIComponent(prefix)}`);

      return objectKeysSchema.parse(await response.json()).keys;
    }),
  );

  expect(keyLists).toEqual([[], []]);

  const remaining = exportRowsSchema.parse(await (await owner.get(rowsPath)).json());

  expect(remaining.exports).toEqual([]);

  await owner.dispose();
});

test("a suspended account never builds an export", async ({ exportServer }) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);

  const requested = await owner.post("/api/account/export");

  expect(requested.status()).toBe(202);

  const { path: rowsPath, rows } = await exportRowsFor(owner, userId);
  const exportId = rows.exports.find((row) => row.status === "preparing")?.id;

  expect(exportId).toBeDefined();

  const suspended = await owner.post("/__test__/user/suspend", {
    data: { suspended: true, userId },
  });

  expect(suspended.ok()).toBe(true);

  const build = await owner.post("/__test__/jobs/run-now", {
    data: { kind: "export.build", payload: JSON.stringify({ exportId }) },
  });

  expect(build.ok()).toBe(true);

  const after = exportRowsSchema.parse(await (await owner.get(rowsPath)).json());

  expect(after.exports[0]?.status).toBe("failed");

  const { keys } = objectKeysSchema.parse(
    await (
      await owner.get(`/__test__/objects?prefix=${encodeURIComponent(`files/${userId}/exports/`)}`)
    ).json(),
  );

  expect(keys).toEqual([]);

  await owner.dispose();
});

test("the link expires after 24 hours and the archive is deleted", async ({ exportServer }) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);
  await seedMail(owner, userId, "Hello from an employer.", "expiry");

  const created = await owner.post("/api/account/export");

  expect(created.status()).toBe(202);

  await waitForReady(owner);

  const state = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());

  expect(state.expiresAt).toBe((state.readyAt ?? 0) + DAY_MS);

  const rows = exportRowsSchema.parse(
    await (
      await owner.get(`/__test__/account/exports?userId=${encodeURIComponent(userId)}`)
    ).json(),
  );

  const objectKey = rows.exports[0]?.objectKey ?? "";

  expect(objectKey).not.toBe("");

  const stored = join(exportServer.objectsRoot, objectKey);

  expect(await Bun.file(stored).exists()).toBe(true);

  await moveClock(owner, (state.expiresAt ?? 0) + 1000);

  const expired = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());

  expect(expired.status).toBe("expired");
  expect(expired.downloadUrl).toBeNull();

  const download = await owner.get(pathOf(state.downloadUrl ?? ""));

  expect(download.status()).toBe(410);

  const after = exportRowsSchema.parse(
    await (
      await owner.get(`/__test__/account/exports?userId=${encodeURIComponent(userId)}`)
    ).json(),
  );

  expect(after.exports[0]?.status).toBe("expired");
  expect(after.exports[0]?.objectKey).toBeNull();
  expect(await Bun.file(stored).exists()).toBe(false);

  await owner.dispose();
});

test("a new request replaces a ready export, with a note", async ({ exportServer }) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);
  await seedMail(owner, userId, "A first message.", "replace");

  await owner.post("/api/account/export");
  await waitForReady(owner);

  const first = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());
  const replaced = await owner.post("/api/account/export");

  const body = z.object({ replaced: z.boolean(), status: z.string() }).parse(await replaced.json());

  expect(body.replaced).toBe(true);
  expect(body.status).toBe("preparing");

  const rows = exportRowsSchema.parse(
    await (
      await owner.get(`/__test__/account/exports?userId=${encodeURIComponent(userId)}`)
    ).json(),
  );

  const oldRow = rows.exports.find((row) => row.id === first.id);

  expect(oldRow?.status).toBe("expired");
  expect(oldRow?.objectKey).toBeNull();

  await waitForReady(owner);

  const second = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());

  expect(second.id).not.toBe(first.id);

  await owner.dispose();
});

test("the export page fits its phone and desktop viewports without annotation text", async ({
  browser,
  exportServer,
}, testInfo) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);
  await seedMail(owner, userId, "A message.", "layout");

  const storageState = await owner.storageState();

  const overflows = await Promise.all(
    [390, 1280].flatMap((width) =>
      ["light", "dark"].map(async (theme) => {
        const context = await browser.newContext({
          storageState,
          viewport: { height: 900, width },
        });

        const page = await context.newPage();

        if (theme === "dark") {
          await page.addInitScript(() => {
            globalThis.localStorage.setItem("overture.theme", "dark");
          });
        }

        await openExportPage(page, exportServer.url);
        await page.evaluate(async () => document.fonts.ready);
        await page.screenshot({
          path: testInfo.outputPath(`export-app-${String(width)}-${theme}.png`),
          fullPage: true,
        });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );

        expect(await page.getByText(/fig\./iu).count()).toBe(0);

        const axe = await new AxeBuilder({ page }).analyze();

        expect(axe.violations, `${String(width)}px`).toEqual([]);

        await context.close();

        return { overflow, width };
      }),
    ),
  );

  expect(overflows.filter((result) => result.overflow > 0)).toEqual([]);

  await owner.dispose();
});

test("another user's export cannot be downloaded", async ({ exportServer }) => {
  const { owner } = await ownerContextFor(exportServer.url);

  const other = createdSchema.parse(
    await (
      await owner.post("/__test__/users", {
        data: { email: "other.download@example.com", name: "Other Download" },
      })
    ).json(),
  );

  const seeded = createdSchema.parse(
    await (
      await owner.post("/__test__/account-exports/seed", { data: { userId: other.id } })
    ).json(),
  );

  expect((await owner.get(`/api/account/export/${seeded.id}/download`)).status()).toBe(404);

  const rows = exportRowsSchema.parse(
    await (
      await owner.get(`/__test__/account/exports?userId=${encodeURIComponent(other.id)}`)
    ).json(),
  );

  expect(rows.exports[0]?.status).toBe("ready");

  await owner.dispose();
});

test("an export needs a signed-in session", async ({ exportServer }) => {
  const anonymous = await apiRequest.newContext({ baseURL: exportServer.url });

  expect((await anonymous.get("/api/account/export")).status()).toBe(401);
  expect((await anonymous.post("/api/account/export")).status()).toBe(401);
  expect((await anonymous.get("/api/account/export/missing/download")).status()).toBe(401);

  await anonymous.dispose();
});

test("a large mailbox builds without holding the archive in memory", async ({ exportServer }) => {
  const first = await ownerContextFor(exportServer.url);

  const bulk = await first.owner.post("/__test__/mail/bulk", {
    data: { bodyBytes: 512 * 1024, count: 200, userId: first.userId },
  });

  expect(bulk.ok()).toBe(true);

  const storage = await first.owner.storageState();

  await first.owner.dispose();
  await exportServer.restart();

  const owner = await apiRequest.newContext({ baseURL: exportServer.url, storageState: storage });

  await moveClock(owner, referenceNow);

  const requested = await owner.post("/api/account/export");

  expect(requested.status()).toBe(202);

  const status = () => {
    const text = readFileSync(`/proc/${String(exportServer.pid)}/status`, "utf8");
    const line = text.split("\n").find((candidate) => candidate.startsWith("VmHWM:")) ?? "0";
    const match = /(?<kb>\d+) kB/u.exec(line);

    return Number(match?.groups?.kb ?? 0);
  };

  const before = status();

  await waitForReady(owner);

  const after = status();

  expect(after - before).toBeLessThan(280 * 1024);

  await owner.dispose();
});

test("an export carries custom calendar events and support tickets", async ({ exportServer }) => {
  const { owner, userId } = await ownerContextFor(exportServer.url);

  await seedOwner(owner);

  const support = await owner.post("/api/support", {
    data: {
      category: "account",
      message: "Please check the address on my account.",
      subject: "Address question",
    },
  });

  expect(support.status()).toBe(201);

  const { referenceId } = z
    .object({ ok: z.literal(true), referenceId: z.string() })
    .parse(await support.json());

  const created = await owner.post("/api/calendar/events", {
    data: {
      company: "Acme",
      dayKey: "2026-12-02",
      kind: "interview",
      time: "09:30",
      title: "Acme call",
    },
  });

  expect(created.status()).toBe(201);

  const requested = await owner.post("/api/account/export");

  expect(requested.status()).toBe(202);

  await waitForReady(owner);

  const state = exportStateSchema.parse(await (await owner.get("/api/account/export")).json());

  expect(state.downloadUrl).not.toBeNull();

  const archive = await downloadArchive(owner, state.downloadUrl ?? "");

  const calendarEvents = unzipJson(
    archive,
    "calendar-events.json",
    z.array(
      z.object({
        company: z.string(),
        dayKey: z.string(),
        kind: z.string(),
        time: z.string().nullable(),
        title: z.string(),
      }),
    ),
  );

  expect(calendarEvents).toMatchObject([
    { company: "Acme", dayKey: "2026-12-02", kind: "interview", time: "09:30", title: "Acme call" },
  ]);

  const supportTickets = unzipJson(
    archive,
    "support-tickets.json",
    z.array(
      z.object({
        category: z.string(),
        message: z.string(),
        referenceId: z.string(),
        status: z.string(),
        subject: z.string(),
        userId: z.string(),
      }),
    ),
  );

  expect(supportTickets).toHaveLength(1);
  expect(supportTickets[0]).toMatchObject({
    category: "account",
    message: "Please check the address on my account.",
    referenceId,
    status: "open",
    subject: "Address question",
    userId,
  });

  await owner.dispose();
});
