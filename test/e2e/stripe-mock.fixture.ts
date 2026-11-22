import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

export interface StripeMockRequest {
  method: string;
  path: string;
  body: string;
}

export interface StripeMock {
  url: string;
  requests: StripeMockRequest[];
  clear: () => void;
  /**
   * Answers GET /v1/checkout/sessions/<id> with a verified setup session whose card has
   * the given fingerprint, the shape Stripe returns after a card check succeeds.
   */
  stubVerifiedSetupSession: (session: { id: string; userId: string; fingerprint: string }) => void;
  stop: () => Promise<void>;
}

const listeningPattern = /^Listening for HTTP at address: (?<host>[^\s:]+):(?<port>\d+)$/u;
const START_TIMEOUT_MS = 10_000;

async function waitForListening(child: ChildProcess) {
  return new Promise<string>((resolve, reject) => {
    let buffered = "";

    const timer = setTimeout(() => {
      reject(new Error("stripe-mock did not start within 10 seconds."));
    }, START_TIMEOUT_MS);

    function settle(error: Error | null, url: string | null) {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", reject);

      if (error !== null) {
        reject(error);
      } else if (url !== null) {
        resolve(url);
      }
    }

    function onData(chunk: Buffer | string) {
      buffered += chunk.toString();

      for (const line of buffered.split("\n")) {
        const groups = listeningPattern.exec(line)?.groups;
        const port = groups?.["port"];

        if (port !== undefined) {
          settle(null, `http://127.0.0.1:${port}`);
        }
      }
    }

    function onExit(code: number | null) {
      settle(new Error(`stripe-mock exited before listening (code ${String(code)}).`), null);
    }

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", (error) => {
      settle(error, null);
    });
  });
}

async function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

export async function startStripeMock() {
  const child = spawn("stripe-mock", ["-http-addr", "127.0.0.1:0", "-https-addr", "127.0.0.1:0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stripeMockUrl = await waitForListening(child);
  const requests: StripeMockRequest[] = [];
  const setupStubs = new Map<string, { userId: string; fingerprint: string }>();

  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      const body =
        request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();

      requests.push({
        body: body === null ? "" : Buffer.from(body).toString("utf8"),
        method: request.method,
        path: url.pathname,
      });

      const sessionId = /^\/v1\/checkout\/sessions\/(?<id>[^/]+)$/u.exec(url.pathname)?.groups?.[
        "id"
      ];

      const stub = sessionId === undefined ? undefined : setupStubs.get(sessionId);

      if (request.method === "GET" && stub !== undefined) {
        return Response.json({
          client_reference_id: stub.userId,
          customer: null,
          id: sessionId,
          mode: "setup",
          setup_intent: {
            payment_method: { card: { fingerprint: stub.fingerprint } },
            status: "succeeded",
          },
          status: "complete",
        });
      }

      const upstream = await fetch(`${stripeMockUrl}${url.pathname}${url.search}`, {
        body,
        headers: {
          authorization: request.headers.get("authorization") ?? "",
          "content-type": request.headers.get("content-type") ?? "",
        },
        method: request.method,
      });

      return new Response(await upstream.arrayBuffer(), {
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
        status: upstream.status,
      });
    },
  });

  const stripeMock: StripeMock = {
    url: `http://127.0.0.1:${String(proxy.port)}`,
    requests,
    clear: () => {
      requests.length = 0;
    },
    stubVerifiedSetupSession: ({ id, userId, fingerprint }) => {
      setupStubs.set(id, { fingerprint, userId });
    },
    stop: async () => {
      await proxy.stop(true);
      child.kill("SIGTERM");
      await waitForExit(child);
    },
  };

  return stripeMock;
}
