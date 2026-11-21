import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { verifyAuthState } from "./sign-in.ts";

const createResponseSchema = z.object({ id: z.string() });

const mailHealthSchema = z.object({
  alerts: z.array(
    z.object({
      companyId: z.string(),
      employer: z.string(),
      replies: z.number(),
      sent: z.number(),
    }),
  ),
  days: z.number(),
  domainAlert: z.object({
    active: z.boolean(),
    replies: z.number(),
    replyRate: z.number().nullable(),
    sent: z.number(),
  }),
  employers: z.array(
    z.object({
      applications: z.number(),
      ats: z.array(z.string()),
      bounces: z.number(),
      companyId: z.string(),
      employer: z.string(),
      killSwitch: z.object({ enabled: z.boolean(), reason: z.string() }).nullable(),
      replies: z.number(),
      sent: z.number(),
      status: z.enum(["healthy", "reply_alert", "too_few_sends", "watch"]),
    }),
  ),
});

const drillSchema = z.object({ raised: z.array(z.string()) });

const clockSchema = z.object({ now: z.number() });

const notificationsSchema = z.object({
  notifications: z.array(z.object({ title: z.string() })),
});

const auditSchema = z.object({
  audit: z.array(
    z.object({
      action: z.string(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      reason: z.string(),
    }),
  ),
});

type Ats = "ashby" | "greenhouse" | "lever" | "workable";

type JsonValue = boolean | JsonValue[] | number | string | null | { [key: string]: JsonValue };

interface EmployerScope {
  ats: Ats;
  boardId: string;
  companyId: string;
  token: string;
}

async function postJson(appUrl: string, path: string, body: JsonValue) {
  const response = await fetch(`${appUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`${path} answered ${String(response.status)}.`);
  }

  return z.unknown().parse(await response.json());
}

async function clockNow(appUrl: string) {
  const response = await fetch(`${appUrl}/__test__/clock`);

  return clockSchema.parse(await response.json()).now;
}

function firstApplicationId(ids: readonly string[]) {
  const [first] = ids;

  if (first === undefined) {
    throw new Error("The seeded employer has no Applications.");
  }

  return first;
}

async function seedEmployer(appUrl: string, ats: Ats, name: string, token: string) {
  const company = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/catalog/companies", { name }),
  );

  const board = createResponseSchema.parse(
    await postJson(appUrl, "/__test__/catalog/boards", {
      ats,
      boardToken: token,
      companyId: company.id,
    }),
  );

  return { ats, boardId: board.id, companyId: company.id, token } satisfies EmployerScope;
}

async function seedSends(
  appUrl: string,
  employer: EmployerScope,
  input: { count: number; sentAt: number; userId: string },
) {
  return await Promise.all(
    Array.from({ length: input.count }, async (_unused, index) => {
      const offset = index + 1;

      const posting = createResponseSchema.parse(
        await postJson(appUrl, "/__test__/catalog/postings", {
          ats: employer.ats,
          atsJobId: `${employer.token}-${String(offset)}`,
          boardId: employer.boardId,
          companyId: employer.companyId,
          title: `Backend Engineer ${String(offset)}`,
          url: `https://boards.example/${employer.token}/jobs/${String(offset)}`,
        }),
      );

      const application = createResponseSchema.parse(
        await postJson(appUrl, "/__test__/applications/seed", {
          postingId: posting.id,
          sentAt: input.sentAt,
          status: "sent",
          userId: input.userId,
        }),
      );

      return application.id;
    }),
  );
}

async function seedMail(
  appUrl: string,
  input: {
    applicationId: string;
    auth?: "pass" | "fail" | "none";
    direction?: "in" | "out";
    outStatus?: "queued" | "sent" | "bounced" | "failed";
    senderDomain: string;
    userId: string;
  },
) {
  await postJson(appUrl, "/__test__/mail/seed", {
    applicationId: input.applicationId,
    auth: input.auth ?? "pass",
    direction: input.direction ?? "in",
    from: `Hiring <jobs@${input.senderDomain}>`,
    outStatus: input.outStatus ?? null,
    senderDomain: input.senderDomain,
    subject: "Your application",
    text: "Thank you for applying.",
    userId: input.userId,
  });
}

async function ownerIdOf(appUrl: string, request: Parameters<typeof verifyAuthState>[1]) {
  const state = await verifyAuthState(appUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("The owner account is missing.");
  }

  return owner.id;
}

test("mail health shows recorded mail by employer, expands a row and pauses a breaching employer", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const appUrl = adminIsolatedAppServer.url;

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const userId = await ownerIdOf(appUrl, page.request);
  const sentAt = (await clockNow(appUrl)) - 24 * 60 * 60 * 1000;

  const halden = await seedEmployer(appUrl, "greenhouse", "Halden Systems", "halden");
  const haldenSends = await seedSends(appUrl, halden, { count: 7, sentAt, userId });

  await seedMail(appUrl, {
    applicationId: firstApplicationId(haldenSends),
    senderDomain: "greenhouse.io",
    userId,
  });
  await seedMail(appUrl, {
    applicationId: firstApplicationId(haldenSends),
    auth: "fail",
    senderDomain: "greenhouse.io",
    userId,
  });

  const corvane = await seedEmployer(appUrl, "lever", "Corvane", "corvane");

  await seedSends(appUrl, corvane, { count: 40, sentAt, userId });

  const quill = await seedEmployer(appUrl, "ashby", "Quill & Rowe", "quill");
  const quillSends = await seedSends(appUrl, quill, { count: 12, sentAt, userId });

  await seedMail(appUrl, {
    applicationId: firstApplicationId(quillSends),
    senderDomain: "ashbyhq.com",
    userId,
  });

  await seedMail(appUrl, {
    applicationId: firstApplicationId(quillSends),
    direction: "out",
    outStatus: "bounced",
    senderDomain: "tryoverture.com",
    userId,
  });

  const fenwick = await seedEmployer(appUrl, "greenhouse", "Fenwick", "fenwick");

  await seedSends(appUrl, fenwick, { count: 2, sentAt, userId });

  const health = mailHealthSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/mail-health`)).json(),
  );

  expect(health.days).toBe(30);
  expect(health.employers.map((row) => row.employer).toSorted()).toEqual([
    "Corvane",
    "Fenwick",
    "Halden Systems",
    "Quill & Rowe",
  ]);

  const corvaneHealth = health.employers.find((row) => row.employer === "Corvane");
  const fenwickHealth = health.employers.find((row) => row.employer === "Fenwick");
  const haldenHealth = health.employers.find((row) => row.employer === "Halden Systems");
  const quillHealth = health.employers.find((row) => row.employer === "Quill & Rowe");

  expect(corvaneHealth?.status).toBe("reply_alert");
  expect(corvaneHealth?.sent).toBe(40);
  expect(corvaneHealth?.ats).toEqual(["lever"]);
  expect(haldenHealth?.status).toBe("healthy");
  expect(haldenHealth?.replies).toBe(2);
  expect(quillHealth?.status).toBe("watch");
  expect(quillHealth?.replies).toBe(1);
  expect(quillHealth?.bounces).toBe(1);
  expect(fenwickHealth?.status).toBe("too_few_sends");

  expect(health.alerts.map((row) => row.employer)).toEqual(["Corvane"]);
  expect(health.domainAlert.active).toBe(true);
  expect(health.domainAlert.sent).toBe(61);

  await page.goto(`${adminIsolatedAppUrl}/admin/mail-health`);

  await expect(page.getByRole("heading", { name: "Mail health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reply-rate alert: Corvane" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Domain reply-rate alert" })).toBeVisible();
  await expect(page.getByText("Per employer, last 30 days.", { exact: false })).toBeVisible();

  await Promise.all(
    ["Corvane", "Fenwick", "Halden Systems", "Quill & Rowe"].map(async (employer) => {
      await expect(page.getByText(employer, { exact: true })).toBeVisible();
    }),
  );

  await expect(page.getByText("Reply alert", { exact: true })).toBeVisible();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Watch, 1 bounce", { exact: true })).toBeVisible();
  await expect(page.getByText("Too few sends", { exact: true })).toBeVisible();
  await expect(page.getByText("Mail in: 2 pass · 1 fail · 0 unverified")).toBeVisible();

  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByText("Per employer, last 7 days.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByText("Per employer, last 30 days.", { exact: false })).toBeVisible();

  const openButton = page.getByRole("button", { name: "Open employer: Corvane", exact: true });

  await expect(openButton).toHaveAttribute("aria-expanded", "false");
  await openButton.click();
  await expect(
    page.getByRole("button", { name: "Close employer: Corvane", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("40 applications in this period")).toBeVisible();

  const openPanel = page.locator('[id^="mail-employer-"]:visible');

  await expect(openPanel.getByText("Kill switch not set")).toBeVisible();

  await page.getByRole("button", { name: "Pause this employer: Corvane", exact: true }).click();

  await expect
    .poll(async () => {
      const view = mailHealthSchema.parse(
        await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/mail-health`)).json(),
      );

      return view.employers.find((row) => row.employer === "Corvane")?.killSwitch?.enabled;
    })
    .toBe(true);

  await expect(page.getByText("Employer paused")).toBeVisible();
  await expect(
    openPanel.getByText("Kill switch on · Reply rate under 5 percent after 10 sends"),
  ).toBeVisible();

  const audit = auditSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/audit`)).json(),
  );

  const pauseRow = audit.audit.find((row) => row.action === "kill_switch.update");

  expect(pauseRow?.reason).toBe("Reply rate under 5 percent after 10 sends");
  expect(pauseRow?.detail["key"]).toBe(corvane.companyId);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${adminIsolatedAppUrl}/admin/mail-health`);

  await expect(page.getByRole("heading", { name: "Mail health" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});

test("the reply-rate alerts fire from the drill and stay quiet for healthy mail", async ({
  page,
  adminIsolatedAppServer,
  adminIsolatedAppUrl,
  accessServer,
}) => {
  test.setTimeout(180_000);

  const appUrl = adminIsolatedAppServer.url;

  await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

  const userId = await ownerIdOf(appUrl, page.request);
  const sentAt = (await clockNow(appUrl)) - 24 * 60 * 60 * 1000;

  const healthy = await seedEmployer(appUrl, "greenhouse", "Halden Systems", "healthy");
  const sends = await seedSends(appUrl, healthy, { count: 10, sentAt, userId });

  await seedMail(appUrl, {
    applicationId: firstApplicationId(sends),
    senderDomain: "greenhouse.io",
    userId,
  });

  const quiet = mailHealthSchema.parse(
    await (await page.request.get(`${adminIsolatedAppUrl}/admin/api/mail-health`)).json(),
  );

  expect(quiet.alerts).toEqual([]);
  expect(quiet.domainAlert.active).toBe(false);

  await postJson(appUrl, "/__test__/jobs/run-now", {
    kind: "live.check",
    payload: JSON.stringify({ groups: ["alerts"] }),
  });

  const notificationsOf = async () =>
    notificationsSchema.parse(
      await (
        await fetch(`${appUrl}/__test__/notifications?userId=${encodeURIComponent(userId)}`)
      ).json(),
    );

  const before = await notificationsOf();

  expect(before.notifications.map((row) => row.title)).not.toContain(
    "Overture alert: mail.reply_rate",
  );
  expect(before.notifications.map((row) => row.title)).not.toContain(
    "Overture alert: mail.domain_reply_rate",
  );

  const drill = drillSchema.parse(await postJson(appUrl, "/__test__/live-checks/drill", {}));

  expect(drill.raised).toContain("mail.reply_rate");
  expect(drill.raised).toContain("mail.domain_reply_rate");

  const after = await notificationsOf();
  const titles = after.notifications.map((row) => row.title);

  expect(titles).toContain("Overture alert: mail.reply_rate");
  expect(titles).toContain("Overture alert: mail.domain_reply_rate");
});
