import { request as apiRequest } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

/**
 * Signs the owner in through a magic link and returns the cookie header and id a browser SSE connection carries.
 * @param appServerUrl The running app server the stream connects to.
 * @returns The cookie header, the owner's user id, and a disposer for the sign-in context.
 */
export async function ownerSseSession(appServerUrl: string) {
  const owner = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, owner, authTestIdentity.ownerEmail);

  await owner.get(link);

  const state = await verifyAuthState(appServerUrl, owner);
  const user = state.users.find((candidate) => candidate.email === authTestIdentity.ownerEmail);
  const storage = await owner.storageState();

  if (user === undefined) {
    throw new Error("the owner signed in but has no user row");
  }

  const cookie = storage.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");

  if (cookie === "") {
    throw new Error("the owner signed in but the session cookie is empty");
  }

  return { cookie, userId: user.id, dispose: async () => owner.dispose() };
}
