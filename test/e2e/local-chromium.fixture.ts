import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChildProcess } from "node:child_process";

import { chromium } from "playwright-core";

const devToolsPattern = /DevTools listening on (?<url>ws:\/\S+)/u;

export interface LocalChromium {
  cdpUrl: string;
  close: () => void;
}

function chromiumExecutable() {
  const executablePath = chromium.executablePath();

  if (executablePath === "") {
    throw new Error("no Chromium executable is installed for the local provider test browser");
  }

  return executablePath;
}

export async function launchLocalChromium() {
  const profileDir = mkdtempSync(join(tmpdir(), "overture-probe-profile-"));

  const args = [
    chromiumExecutable(),
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--headless=new",
    "--disable-gpu",
    "--host-resolver-rules=MAP * 127.0.0.1",
    "--no-sandbox",
    "about:blank",
  ];

  const executable = args[0] ?? "";

  const child: ChildProcess = spawn(executable, args.slice(1), {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const stderrStream = child.stderr;

  const cdpUrl = await new Promise<string>((resolve, reject) => {
    let stderr = "";

    child.once("error", reject);

    child.once("exit", (code) => {
      reject(new Error(`chromium exited (code ${String(code)}): ${stderr.slice(0, 500)}`));
    });

    if (stderrStream === null) {
      reject(new Error("chromium produced no stderr to read the CDP URL from"));

      return;
    }

    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk;

      const match = devToolsPattern.exec(stderr);

      if (match !== null && match.groups?.url !== undefined) {
        resolve(match.groups.url);
      }
    });
  });

  return {
    cdpUrl,
    close: () => {
      child.kill("SIGTERM");
    },
  } satisfies LocalChromium;
}
