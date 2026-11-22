import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import type { ChildProcess } from "node:child_process";

import { testAuthEnvironment } from "./auth.fixture.ts";

const listeningPattern = /^overture listening on (?<port>\d+)$/u;

export interface AppServer {
  url: string;
  databasePath: string;
  objectsRoot: string;
  pid: number;
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
    if (extraEnvironment[key] === undefined) {
      defaults[key] = value;
    }
  }

  return defaults;
}

function developerEnvKeys() {
  if (!existsSync(".env")) {
    return [];
  }

  return readFileSync(".env", "utf8")
    .split("\n")
    .map((line) => /^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)?.groups?.key)
    .filter((key): key is string => key !== undefined);
}

export function serverEnvironment(extraEnvironment: Record<string, string>) {
  const developerKeys = new Set(developerEnvKeys());

  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !developerKeys.has(key) || extraEnvironment[key] !== undefined,
    ),
  );

  const merged = {
    ...inherited,
    NODE_ENV: "test",
    PORT: "0",
    STATIC_ROOT: "dist",
    ENABLE_TEST_ROUTES: "true",
    TURNSTILE_SCRIPT_URL: "/__test__/turnstile-api.js",
    TURNSTILE_HOSTNAMES: "localhost,127.0.0.1",
    LAB_RECAPTCHA_SCRIPT_URL: "/__test__/lab-recaptcha.js",
    LAB_HCAPTCHA_SCRIPT_URL: "/__test__/lab-hcaptcha.js",
    LAB_TURNSTILE_SCRIPT_URL: "/__test__/lab-turnstile.js",
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
  const child = spawn("bun", ["--no-env-file", "run", "src/server/main.ts"], {
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
    get pid() {
      return child.pid ?? 0;
    },
    databasePath,
    objectsRoot: extraEnvironment.OBJECT_STORE_ROOT ?? "",
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
