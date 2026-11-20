import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

import type { IdentityPersona } from "./identity-persona.ts";

export interface IdentityServer {
  url: string;
  setPersona: (persona: IdentityPersona) => Promise<void>;
  stop: () => Promise<void>;
}

const readyPattern = /^identity listening on (?<port>\d+)/u;

async function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

export async function startIdentityServer() {
  const child = spawn("bun", ["run", "test/e2e/identity-server-child.ts"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const url = await new Promise<string>((resolve, reject) => {
    let buffer = "";

    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`The identity server exited before listening (code ${String(code)}).`));
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;

      const port = readyPattern.exec(buffer)?.groups?.port;

      if (port !== undefined) {
        resolve(`http://127.0.0.1:${port}`);
      }
    });
  });

  return {
    url,
    setPersona: async (persona: IdentityPersona) => {
      await fetch(`${url}/_persona`, { method: "POST", body: JSON.stringify(persona) });
    },
    stop: async () => {
      child.kill("SIGTERM");
      await waitForExit(child);
    },
  };
}
