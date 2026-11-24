import { eq } from "drizzle-orm";

import type { APIRequestContext } from "@playwright/test";

import { normaliseEmail } from "../../src/server/auth/email.ts";
import { inviteEmailHash } from "../../src/server/auth/invites.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import { invites, users } from "../../src/server/platform/db/schema.ts";
import { expect, test } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import {
  clearSinkMail,
  latestMailLink,
  requestMagicLink,
  setTurnstileScenario,
  signInByMagicLink,
  sinkMailCount,
  verifyAuthState,
} from "./sign-in.ts";

function addInvite(databasePath: string, email: string) {
  const { db, sqlite } = openDatabase(databasePath);

  db.insert(invites)
    .values({
      id: crypto.randomUUID(),
      emailHash: inviteEmailHash(authTestIdentity.secret, email),
      createdAt: new Date(),
    })
    .run();

  sqlite.close();
}

function addUnverifiedUser(databasePath: string, email: string) {
  const { db, sqlite } = openDatabase(databasePath);

  db.insert(users)
    .values({
      id: crypto.randomUUID(),
      name: "A squatter",
      email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  sqlite.close();
}

function suspendMailbox(databasePath: string, email: string) {
  const { db, sqlite } = openDatabase(databasePath);

  db.update(users).set({ suspendedAt: new Date() }).where(eq(users.email, email)).run();

  sqlite.close();
}

async function accountCounts(appServerUrl: string, request: APIRequestContext) {
  const state = await verifyAuthState(appServerUrl, request);

  return {
    gmailUsers: state.users.filter((user) => normaliseEmail(user.email).endsWith("@gmail.com"))
      .length,
    sessions: state.sessions.length,
    users: state.users.length,
  };
}

function usersWithMailbox(state: Awaited<ReturnType<typeof verifyAuthState>>, email: string) {
  const mailbox = normaliseEmail(email);

  return state.users.filter((user) => normaliseEmail(user.email) === mailbox);
}

test("a suspended Gmail mailbox cannot return through a dot or plus alias", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url, databasePath } = isolatedAppServer;
  const guest = "tmp.beta@gmail.com";

  addInvite(databasePath, guest);

  await signInByMagicLink(page, url, request, guest);
  await expect(page.getByRole("heading", { name: /Upload your resume/u })).toBeVisible();

  suspendMailbox(databasePath, guest);

  const before = await accountCounts(url, request);

  expect(before.gmailUsers).toBe(1);

  await clearSinkMail(url, request);
  await setTurnstileScenario(request, url, { action: "magiclink" });

  const aliased = await requestMagicLink(url, request, "t.m.p.beta+2@gmail.com");

  expect(aliased.status()).toBe(403);
  expect(await sinkMailCount(url, request)).toBe(0);
  expect(await accountCounts(url, request)).toEqual(before);
});

test("an invited mailbox gets one account, not one per Gmail alias", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url, databasePath } = isolatedAppServer;
  const guest = "alias.guest@gmail.com";

  addInvite(databasePath, guest);

  await signInByMagicLink(page, url, request, guest);
  await expect(page.getByRole("heading", { name: /Upload your resume/u })).toBeVisible();

  const before = await accountCounts(url, request);

  expect(before.gmailUsers).toBe(1);

  await clearSinkMail(url, request);
  await setTurnstileScenario(request, url, { action: "magiclink" });
  await requestMagicLink(url, request, "alias.guest+other@gmail.com");

  const aliasedLink = await latestMailLink(url, request, "alias.guest+other@gmail.com");

  await request.get(aliasedLink);

  const after = await accountCounts(url, request);

  expect(after).toEqual(before);
  expect(after.gmailUsers).toBe(1);
});

test("an unverified row on another spelling does not hold an invited mailbox", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url, databasePath } = isolatedAppServer;
  const guest = "squatted.guest@gmail.com";

  addInvite(databasePath, guest);
  addUnverifiedUser(databasePath, "squatted.guest+attacker@gmail.com");

  await signInByMagicLink(page, url, request, guest);
  await expect(page.getByRole("heading", { name: /Upload your resume/u })).toBeVisible();

  const state = await verifyAuthState(url, request);
  const rows = usersWithMailbox(state, guest);

  expect(rows).toHaveLength(1);
  expect(rows[0]?.email).toBe(guest);
  expect(rows[0]?.emailVerified).toBe(true);
  expect(state.sessions.filter((session) => session.userId === rows[0]?.id)).toHaveLength(1);
});
