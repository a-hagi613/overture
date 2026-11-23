import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { ownerContextFor } from "./matching-harness.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ calendarServer: AppServer }>({
  calendarServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const eventSchema = z.object({
  company: z.string(),
  createdAt: z.number(),
  dayKey: z.string(),
  id: z.string(),
  kind: z.enum(["interview", "followup", "reminder"]),
  time: z.string().nullable(),
  title: z.string(),
  updatedAt: z.number(),
});

const eventResponseSchema = z.object({ event: eventSchema });

const eventsResponseSchema = z.object({ events: z.array(eventSchema) });

const feedTokenSchema = z.object({ path: z.string(), status: z.object({ enabled: z.boolean() }) });

const createdSchema = z.object({ id: z.string() });

const validationErrorSchema = z.object({
  error: z.literal("invalid_request"),
  issues: z.array(z.unknown()).min(1),
});

async function createEvent(
  request: APIRequestContext,
  data: {
    company?: string;
    dayKey: string;
    kind: "interview" | "followup" | "reminder";
    time?: string | null;
    title: string;
  },
) {
  const response = await request.post("/api/calendar/events", { data });

  expect(response.status()).toBe(201);

  return eventResponseSchema.parse(await response.json()).event;
}

async function eventsOf(request: APIRequestContext, query = "") {
  const response = await request.get(`/api/calendar/events${query}`);

  expect(response.ok()).toBe(true);

  return eventsResponseSchema.parse(await response.json()).events;
}

async function signInAs(serverUrl: string, email: string) {
  const context = await apiRequest.newContext({ baseURL: serverUrl });

  await requestMagicLink(serverUrl, context, email);

  const link = await latestMailLink(serverUrl, context, email);

  await context.get(link);

  return context;
}

test("custom Calendar events are created, listed by day window and deleted", async ({
  calendarServer,
}) => {
  const { owner } = await ownerContextFor(calendarServer.url);

  const interview = await createEvent(owner, {
    company: "Acme",
    dayKey: "2026-12-02",
    kind: "interview",
    time: "09:30",
    title: "Acme call",
  });

  expect(interview).toMatchObject({
    company: "Acme",
    dayKey: "2026-12-02",
    kind: "interview",
    time: "09:30",
    title: "Acme call",
  });

  const reminder = await createEvent(owner, {
    dayKey: "2026-12-20",
    kind: "reminder",
    title: "Chase the recruiter",
  });

  expect(reminder.time).toBeNull();
  expect(reminder.company).toBe("");

  const all = await eventsOf(owner);

  expect(all.map((event) => event.id)).toEqual([interview.id, reminder.id]);

  const window = await eventsOf(owner, "?from=2026-12-01&to=2026-12-05");

  expect(window.map((event) => event.id)).toEqual([interview.id]);

  const deleted = await owner.delete(`/api/calendar/events/${reminder.id}`);

  expect(deleted.status()).toBe(200);
  expect((await eventsOf(owner)).map((event) => event.id)).toEqual([interview.id]);

  const missing = await owner.delete(`/api/calendar/events/${reminder.id}`);

  expect(missing.status()).toBe(404);

  await owner.dispose();
});

test("a malformed day or time answers the shared invalid_request shape", async ({
  calendarServer,
}) => {
  const { owner } = await ownerContextFor(calendarServer.url);

  const rolledDay = await owner.post("/api/calendar/events", {
    data: { dayKey: "2026-02-31", kind: "interview", title: "Impossible day" },
  });

  expect(rolledDay.status()).toBe(400);
  validationErrorSchema.parse(await rolledDay.json());

  const looseTime = await owner.post("/api/calendar/events", {
    data: { dayKey: "2026-12-02", kind: "interview", time: "9:30", title: "Loose time" },
  });

  expect(looseTime.status()).toBe(400);
  validationErrorSchema.parse(await looseTime.json());

  const halfWindow = await owner.get("/api/calendar/events?from=2026-12-01");

  expect(halfWindow.status()).toBe(400);
  validationErrorSchema.parse(await halfWindow.json());

  await owner.dispose();
});

test("another account can neither list nor delete a custom event", async ({ calendarServer }) => {
  const { owner } = await ownerContextFor(calendarServer.url);

  const event = await createEvent(owner, {
    dayKey: "2026-12-02",
    kind: "followup",
    title: "Private follow-up",
  });

  const created = await owner.post("/__test__/users", {
    data: { email: "other.calendar@example.com", name: "Other Calendar" },
  });

  const otherUserId = createdSchema.parse(await created.json()).id;

  expect(otherUserId).not.toBe("");

  const other = await signInAs(calendarServer.url, "other.calendar@example.com");

  expect(await eventsOf(other)).toEqual([]);

  const refused = await other.delete(`/api/calendar/events/${event.id}`);

  expect(refused.status()).toBe(404);
  expect((await eventsOf(owner)).map((candidate) => candidate.id)).toEqual([event.id]);

  await other.dispose();
  await owner.dispose();
});

test("the .ics feed carries the user's custom events and escapes their text", async ({
  calendarServer,
}) => {
  const { owner } = await ownerContextFor(calendarServer.url);

  await createEvent(owner, {
    company: "Acme, Inc.",
    dayKey: "2026-12-02",
    kind: "interview",
    time: "09:30",
    title: "Acme call",
  });

  await createEvent(owner, {
    dayKey: "2026-12-20",
    kind: "reminder",
    title: "Chase the recruiter",
  });

  const tokenResponse = await owner.post("/api/calendar/feed/token");

  expect(tokenResponse.ok()).toBe(true);

  const token = feedTokenSchema.parse(await tokenResponse.json());

  const anonymous = await apiRequest.newContext({ baseURL: calendarServer.url });
  const response = await anonymous.get(token.path);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("text/calendar; charset=utf-8");

  const body = await response.text();

  expect(body).toContain(String.raw`SUMMARY:Interview: Acme call at Acme\, Inc.`);
  expect(body).toContain("DTSTART:20261202T093000Z");
  expect(body).toContain("SUMMARY:Reminder: Chase the recruiter");
  expect(body).toContain("DTSTART;VALUE=DATE:20261220");

  await anonymous.dispose();
  await owner.dispose();
});

test("signed-out requests are refused", async ({ calendarServer }) => {
  const anonymous = await apiRequest.newContext({ baseURL: calendarServer.url });

  expect((await anonymous.get("/api/calendar/events")).status()).toBe(401);
  expect(
    (
      await anonymous.post("/api/calendar/events", {
        data: { dayKey: "2026-12-02", kind: "interview", title: "Nope" },
      })
    ).status(),
  ).toBe(401);
  expect((await anonymous.delete("/api/calendar/events/event-1")).status()).toBe(401);

  await anonymous.dispose();
});
