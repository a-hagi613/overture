import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

import { testAuthEnvironment } from "./auth.fixture.ts";

const listeningPattern = /^overture listening on (?<port>\d+)$/u;

export interface AppServer {
  url: string;
  databasePath: string;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  crash: () => Promise<void>;
  waitForStderr: (pattern: RegExp) => Promise<string>;
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

interface StderrWaiter {
  pattern: RegExp;
  resolve: (line: string) => void;
}

function createStderrMonitor() {
  let text = "";
  const waiters = new Set<StderrWaiter>();

  function settle(line: string) {
    for (const waiter of waiters) {
      if (waiter.pattern.test(line)) {
        waiters.delete(waiter);
        waiter.resolve(line);
      }
    }
  }

  function onChunk(chunk: string) {
    process.stderr.write(chunk);
    text += chunk;

    for (const line of chunk.split("\n")) {
      settle(line);
    }
  }

  async function waitFor(pattern: RegExp) {
    const existing = text.split("\n").find((line) => pattern.test(line));

    if (existing !== undefined) {
      return existing;
    }

    return new Promise<string>((resolve) => {
      waiters.add({ pattern, resolve });
    });
  }

  return { onChunk, waitFor };
}

function authDefaults(extraEnvironment: Record<string, string>) {
  const defaults: Record<string, string> = {};

  for (const [key, value] of Object.entries(testAuthEnvironment)) {
    if (process.env[key] === undefined && extraEnvironment[key] === undefined) {
      defaults[key] = value;
    }
  }

  return defaults;
}

export function serverEnvironment(extraEnvironment: Record<string, string>) {
  const merged = {
    ...process.env,
    NODE_ENV: "test",
    PORT: "0",
    STATIC_ROOT: "dist",
    ENABLE_TEST_ROUTES: "true",
    OTEL_SIMPLE_EXPORT: "true",
    KILL_TIMEOUT_MS: "1000",
    ...authDefaults(extraEnvironment),
    ...extraEnvironment,
  };

  return Object.fromEntries(Object.entries(merged).filter(([key]) => extraEnvironment[key] !== ""));
}

async function spawnServer(
  databasePath: string,
  extraEnvironment: Record<string, string>,
  stderr: ReturnType<typeof createStderrMonitor>,
) {
  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment(extraEnvironment),
      DATABASE_URL: databasePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr.onChunk(chunk);
  });

  return new Promise<{ child: ChildProcess; url: string }>((resolve, reject) => {
    let buffer = "";

    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`The app server exited before listening (code ${String(code)}).`));
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;

      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        const port = listeningPattern.exec(line)?.groups?.port;

        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        if (port !== undefined) {
          resolve({ child, url: `http://127.0.0.1:${port}` });
        }
      }
    });
  });
}

export async function startAppServer(
  databasePath: string,
  extraEnvironment: Record<string, string> = {},
) {
  const stderr = createStderrMonitor();

  let { child, url } = await spawnServer(databasePath, extraEnvironment, stderr);

  const server: AppServer = {
    get url() {
      return url;
    },
    databasePath,
    waitForStderr: stderr.waitFor,
    stop: async () => {
      child.kill("SIGTERM");
      await waitForExit(child);
    },
    restart: async () => {
      child.kill("SIGTERM");
      await waitForExit(child);

      const { child: nextChild, url: nextUrl } = await spawnServer(
        databasePath,
        extraEnvironment,
        stderr,
      );

      child = nextChild;
      url = nextUrl;
    },
    crash: async () => {
      child.kill("SIGKILL");
      await waitForExit(child);
    },
  };

  return server;
}
