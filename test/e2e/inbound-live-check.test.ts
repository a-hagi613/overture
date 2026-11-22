import { mkdirSync } from "node:fs";

import { z } from "zod";

import { openDatabase } from "../../src/server/platform/db/client.ts";
import { liveCheckMail } from "../../src/server/platform/db/schema.ts";
import {
  INBOUND_DEAD_LETTER_PATH,
  INBOUND_HEADERS,
  INBOUND_PATH,
  signInbound,
} from "../../src/shared/inbound-mail.ts";

import { startFreshAppServer, expect, test } from "./app.fixture.ts";

const secret = "e2e-live-check-hmac-secret-0123456789";
const liveCheckAddress = "live-check@tryoverture.com";
const MAX_DEAD_LETTER_BYTES = 8192;
const T0 = Date.UTC(2026, 10, 22, 9, 0, 0);

const clockSchema = z.object({ now: z.number() });
const keysSchema = z.object({ keys: z.array(z.string()) });

const mailRowsSchema = z.object({
  mail: z.array(z.object({ auth: z.string().nullable(), receivedCode: z.string().nullable() })),
});

function messageWithToken(token: string) {
  return new TextEncoder().encode(
    `Subject: Overture live check\r\nContent-Type: text/plain\r\n\r\ntoken: ${token}\r\ncode: ABCDEFGH\r\n`,
  );
}

async function clockSeconds(url: string) {
  const response = await fetch(`${url}/__test__/clock`);

  return Math.trunc(clockSchema.parse(await response.json()).now / 1000);
}

async function postSigned(
  url: string,
  path: string,
  body: Uint8Array<ArrayBuffer>,
  rcptTo: string,
) {
  const timestamp = await clockSeconds(url);
  const signed = await signInbound(secret, { body, rcptTo, timestamp });

  return fetch(`${url}${path}`, {
    body,
    headers: {
      "content-type": "message/rfc822",
      [INBOUND_HEADERS.mailFrom]: "sender@forwarder.test",
      [INBOUND_HEADERS.rcptTo]: rcptTo,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
    },
    method: "POST",
  });
}

async function objectKeys(url: string, prefix: string) {
  const response = await fetch(`${url}/__test__/objects?prefix=${encodeURIComponent(prefix)}`);

  return keysSchema.parse(await response.json()).keys;
}

test("an inbound mail with a token no check issued writes no recording", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, { INBOUND_HMAC_SECRET: secret });

  try {
    const response = await postSigned(
      server.url,
      INBOUND_PATH,
      messageWithToken("0123456789abcdef0123456789abcdef"),
      liveCheckAddress,
    );

    expect(response.status).toBe(204);

    mkdirSync(server.objectsRoot, { recursive: true });

    expect(await objectKeys(server.url, "recordings/")).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("an inbound mail with an issued live-check token stores the recording and result", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, { INBOUND_HMAC_SECRET: secret });

  try {
    const token = crypto.randomUUID();
    const { db, sqlite } = openDatabase(server.databasePath);

    db.insert(liveCheckMail)
      .values({
        auth: null,
        code: "ABCDEFGH",
        id: crypto.randomUUID(),
        receivedAt: null,
        receivedCode: null,
        resolvedAt: null,
        sentAt: T0,
        toAddress: liveCheckAddress,
        token,
      })
      .run();

    sqlite.close();

    const response = await postSigned(
      server.url,
      INBOUND_PATH,
      messageWithToken(token),
      liveCheckAddress,
    );

    expect(response.status).toBe(204);
    expect(await objectKeys(server.url, "recordings/")).toEqual([`recordings/mail/${token}.eml`]);

    const rows = mailRowsSchema.parse(
      await (await fetch(`${server.url}/__test__/live-checks/mail`)).json(),
    );

    expect(rows.mail[0]?.auth).toBe("none");
    expect(rows.mail[0]?.receivedCode).toBe("ABCDEFGH");
  } finally {
    await server.stop();
  }
});

test("an oversized inbound body without a content-length header is refused", async ({
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, { INBOUND_HMAC_SECRET: secret });

  try {
    const oversized = new Uint8Array(MAX_DEAD_LETTER_BYTES + 1).fill(65);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });

    const response = await fetch(`${server.url}${INBOUND_DEAD_LETTER_PATH}`, {
      body,
      headers: {
        "content-type": "message/rfc822",
        [INBOUND_HEADERS.rcptTo]: liveCheckAddress,
        [INBOUND_HEADERS.signature]: "0".repeat(64),
        [INBOUND_HEADERS.timestamp]: "1",
      },
      method: "POST",
    });

    expect(response.status).toBe(413);
  } finally {
    await server.stop();
  }
});
