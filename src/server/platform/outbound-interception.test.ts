import { expect, test } from "bun:test";
import https from "node:https";

import {
  createInterceptionServer,
  http,
  HttpResponse,
  UnhandledRequestError,
} from "./outbound-interception.ts";

test("a fetch to an unmocked host rejects with the interception error", async () => {
  const server = createInterceptionServer();

  server.listen();

  try {
    let failure: unknown;

    try {
      await fetch("https://unmocked.invalid/probe");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(UnhandledRequestError);
  } finally {
    server.close();
  }
});

test("a mocked fetch answers from its handler", async () => {
  const server = createInterceptionServer(
    http.get("https://mocked.invalid/probe", () => HttpResponse.json({ mocked: true })),
  );

  server.listen();

  try {
    const response = await fetch("https://mocked.invalid/probe");

    expect(await response.json()).toEqual({ mocked: true });
  } finally {
    server.close();
  }
});

test("a mocked node https get answers from its handler", async () => {
  const server = createInterceptionServer(
    http.get("https://mocked.invalid/probe", () => HttpResponse.json({ mocked: true })),
  );

  server.listen();

  try {
    const body = await new Promise<string>((resolve, reject) => {
      https
        .get("https://mocked.invalid/probe", (response) => {
          let received = "";

          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            received += chunk;
          });
          response.on("end", () => {
            resolve(received);
          });
        })
        .on("error", reject);
    });

    expect(JSON.parse(body)).toEqual({ mocked: true });
  } finally {
    server.close();
  }
});

test("a request to a loopback fixture passes through", async () => {
  const fixture = Bun.serve({ port: 0, fetch: () => new Response("loopback") });
  const server = createInterceptionServer();

  server.listen();

  try {
    const response = await fetch(`http://127.0.0.1:${String(fixture.port)}/`);

    expect(await response.text()).toBe("loopback");
  } finally {
    server.close();
    await fixture.stop(true);
  }
});

test("a node https request to an unmocked host rejects with the interception error", async () => {
  const server = createInterceptionServer();

  server.listen();

  try {
    let failure: unknown;

    try {
      await new Promise<number | undefined>((resolve, reject) => {
        const request = https.request("https://unmocked.invalid/probe", (response) => {
          resolve(response.statusCode);
        });

        request.on("error", reject);
        request.end();
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(UnhandledRequestError);
  } finally {
    server.close();
  }
});
