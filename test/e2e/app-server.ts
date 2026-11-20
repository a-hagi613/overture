import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

const listeningPattern = /^overture listening on (?<port>\d+)$/u;

export interface AppServer {
  url: string;
  databasePath: string;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}

async function waitForExit(child: ChildProcess) {
  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

async function spawnServer(databasePath: string) {
  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      DATABASE_URL: databasePath,
      STATIC_ROOT: "dist",
      ENABLE_TEST_ROUTES: "true",
      OTEL_SIMPLE_EXPORT: "true",
    },
    stdio: ["ignore", "pipe", "inherit"],
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

export async function startAppServer(databasePath: string) {
  let { child, url } = await spawnServer(databasePath);

  const server: AppServer = {
    get url() {
      return url;
    },
    databasePath,
    stop: async () => {
      child.kill("SIGTERM");
      await waitForExit(child);
    },
    restart: async () => {
      child.kill("SIGTERM");
      await waitForExit(child);
      const { child: nextChild, url: nextUrl } = await spawnServer(databasePath);

      child = nextChild;
      url = nextUrl;
    },
  };

  return server;
}
