import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { createClock } from "../../src/server/platform/ports/clock.ts";
import {
  INBOUND_HEADERS,
  INBOUND_PATH,
  forwardingLocalPart,
  verifyInbound,
} from "../../src/shared/inbound-mail.ts";
import worker from "../../workers/inbound-mail/src/index.ts";

const secret = "local-inbound-hmac-secret";
const owner = "owner@example.com";
const id = "4f8c2a1b";
const clock = createClock();

function fixture(name: string) {
  return Uint8Array.from(readFileSync(join(process.cwd(), "test/e2e/fixtures/inbound-mail", name)));
}

function forwardable(raw: Uint8Array<ArrayBuffer>, to: string) {
  const forwarded: string[] = [];
  const rejected: string[] = [];

  const message = {
    from: "bounce@us.greenhouse-mail.io",
    to,
    rawSize: raw.byteLength,
    raw: new Blob([raw]).stream(),
    forward: async (address: string) => {
      forwarded.push(address);
      await Promise.resolve();
    },
    setReject: (reason: string) => {
      rejected.push(reason);
    },
  };

  return { message, forwarded, rejected };
}

function startEdge(secretValue: string, refusal?: number) {
  const requests: {
    path: string;
    timestamp: string | null;
    signature: string | null;
    rcptTo: string | null;
    mailFrom: string | null;
    body: Uint8Array;
    verdict: Awaited<ReturnType<typeof verifyInbound>>;
  }[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = new Uint8Array(await request.arrayBuffer());
      const timestamp = request.headers.get(INBOUND_HEADERS.timestamp);
      const signature = request.headers.get(INBOUND_HEADERS.signature);
      const rcptTo = request.headers.get(INBOUND_HEADERS.rcptTo);

      const verdict = await verifyInbound(secretValue, {
        timestamp,
        signature,
        rcptTo,
        body,
        nowSeconds: Math.floor(clock.now() / 1000),
      });

      requests.push({
        path: new URL(request.url).pathname,
        timestamp,
        signature,
        rcptTo,
        mailFrom: request.headers.get(INBOUND_HEADERS.mailFrom),
        body,
        verdict,
      });

      return new Response(null, { status: refusal ?? (verdict.ok ? 202 : 401) });
    },
  });

  return {
    origin: server.url.origin,
    requests,
    stop: async () => {
      await server.stop(true);
    },
  };
}

async function forwardingAddress() {
  return `${await forwardingLocalPart(secret, id)}@tryoverture.com`;
}

const env = (origin: string) => ({
  INBOUND_HMAC_SECRET: secret,
  OVERTURE_ORIGIN: origin,
  OWNER_FORWARD_TO: owner,
});

test("an ATS message is posted with a valid signature", async () => {
  const edge = startEdge(secret);
  const raw = fixture("greenhouse-application.eml");
  const to = await forwardingAddress();
  const { message, forwarded, rejected } = forwardable(raw, to);

  try {
    await worker.email(message, env(edge.origin));
  } finally {
    await edge.stop();
  }

  expect(edge.requests).toHaveLength(1);
  expect(edge.requests[0]?.path).toBe(INBOUND_PATH);
  expect(edge.requests[0]?.verdict).toEqual({ ok: true });
  expect(edge.requests[0]?.rcptTo).toBe(to);
  expect(edge.requests[0]?.mailFrom).toBe("bounce@us.greenhouse-mail.io");
  expect(edge.requests[0]?.body).toEqual(raw);
  expect(forwarded).toHaveLength(0);
  expect(rejected).toHaveLength(0);
});

test("a non-ATS message is dropped without a request", async () => {
  const edge = startEdge(secret);

  const { message, forwarded, rejected } = forwardable(
    fixture("non-ats-newsletter.eml"),
    await forwardingAddress(),
  );

  try {
    await worker.email(message, env(edge.origin));
  } finally {
    await edge.stop();
  }

  expect(edge.requests).toHaveLength(0);
  expect(forwarded).toHaveLength(0);
  expect(rejected).toHaveLength(0);
});

test("a forged forwarding address is dropped without a request", async () => {
  const edge = startEdge(secret);

  const { message, forwarded, rejected } = forwardable(
    fixture("greenhouse-application.eml"),
    `in-${id}-0000000000@tryoverture.com`,
  );

  try {
    await worker.email(message, env(edge.origin));
  } finally {
    await edge.stop();
  }

  expect(edge.requests).toHaveLength(0);
  expect(forwarded).toHaveLength(0);
  expect(rejected).toHaveLength(0);
});

test("a live check message reaches the app even though its sender is not an ATS", async () => {
  const edge = startEdge(secret);
  const raw = fixture("non-ats-newsletter.eml");
  const { message, forwarded, rejected } = forwardable(raw, "live-check@tryoverture.com");

  try {
    await worker.email(message, env(edge.origin));
  } finally {
    await edge.stop();
  }

  expect(edge.requests).toHaveLength(1);
  expect(edge.requests[0]?.path).toBe(INBOUND_PATH);
  expect(edge.requests[0]?.verdict).toEqual({ ok: true });
  expect(edge.requests[0]?.rcptTo).toBe("live-check@tryoverture.com");
  expect(edge.requests[0]?.body).toEqual(raw);
  expect(forwarded).toHaveLength(0);
  expect(rejected).toHaveLength(0);
});

test("a Gmail forwarding confirmation is forwarded to the owner", async () => {
  const edge = startEdge(secret);

  const { message, forwarded, rejected } = forwardable(
    fixture("gmail-forwarding-confirmation.eml"),
    await forwardingAddress(),
  );

  try {
    await worker.email(message, env(edge.origin));
  } finally {
    await edge.stop();
  }

  expect(edge.requests).toHaveLength(0);
  expect(forwarded).toEqual([owner]);
  expect(rejected).toHaveLength(0);
});

test("a refused POST throws so Email Routing retries", async () => {
  const edge = startEdge(secret, 503);
  const { message } = forwardable(fixture("greenhouse-application.eml"), await forwardingAddress());

  try {
    await expect(worker.email(message, env(edge.origin))).rejects.toThrow("refused");
  } finally {
    await edge.stop();
  }

  expect(edge.requests).toHaveLength(1);
});
