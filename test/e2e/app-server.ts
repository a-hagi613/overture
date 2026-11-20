import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

const listeningPattern = /^overture listening on (?<port>\d+)$/u;

export interface AppServer {
  url: string;
  stop: () => Promise<void>;
}

async function waitForExit(child: ChildProcess) {
  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

export async function startAppServer(databasePath: string) {
  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      DATABASE_URL: databasePath,
      STATIC_ROOT: "dist",
      ENABLE_TEST_ROUTES: "true",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });

  return await new Promise<AppServer>((resolve, reject) => {
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
          resolve({
            url: `http://127.0.0.1:${port}`,
            stop: async () => {
              child.kill("SIGTERM");
              await waitForExit(child);
            },
          });
        }
      }
    });
  });
}
