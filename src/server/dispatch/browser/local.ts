import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { z } from "zod";

import type { Clock } from "../../platform/ports/clock.ts";
import type { BrowserProvider, OpenBrowserInput } from "./provider.ts";

const devToolsPattern = /DevTools listening on (?<url>ws:\/\/\S+)/u;

const STOP_GRACE_MS = 2000;

const sessionRecordSchema = z.object({
  attemptId: z.string(),
  cdpUrl: z.string(),
  pid: z.number().int().positive(),
  sessionId: z.string(),
  startedAt: z.number().int(),
});

type SessionRecord = z.infer<typeof sessionRecordSchema>;

const recordFile = (directory: string, sessionId: string) => join(directory, `${sessionId}.json`);

async function readRecord(directory: string, sessionId: string) {
  try {
    return sessionRecordSchema.parse(
      JSON.parse(await readFile(recordFile(directory, sessionId), "utf8")),
    );
  } catch {
    return null;
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, clock: Clock, deadline: number) {
  if (!alive(pid) || clock.now() >= deadline) {
    return !alive(pid);
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

  return waitForExit(pid, clock, deadline);
}

async function stopPid(pid: number, clock: Clock) {
  if (!alive(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  if (await waitForExit(pid, clock, clock.now() + STOP_GRACE_MS)) {
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

function launchArguments(profileDirectory: string) {
  return [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "about:blank",
  ];
}

async function ensureProfile(userId: string) {
  await Promise.resolve();

  return userId;
}

async function deleteProfile() {
  await Promise.resolve();
}

export function createLocalBrowserProvider(deps: { clock: Clock; sessionDirectory: string }) {
  const { clock, sessionDirectory } = deps;

  async function open(input: OpenBrowserInput) {
    await mkdir(sessionDirectory, { recursive: true });

    const executable = chromium.executablePath();

    if (executable === "") {
      throw new Error("the local browser provider has no Chromium executable");
    }

    const sessionId = crypto.randomUUID();

    const profileDirectory = join(sessionDirectory, "profiles", input.profileId ?? "anonymous");

    await mkdir(profileDirectory, { recursive: true });

    const child = spawn(executable, launchArguments(profileDirectory), {
      stdio: ["ignore", "ignore", "pipe"],
    });

    const { stderr } = child;

    const cdpUrl = await new Promise<string>((resolve, reject) => {
      let buffer = "";

      child.once("error", reject);
      child.once("exit", (code) => {
        reject(new Error(`the local browser exited before listening (code ${String(code)}).`));
      });

      stderr.setEncoding("utf8");
      stderr.on("data", (chunk: string) => {
        buffer += chunk;

        const match = devToolsPattern.exec(buffer);

        if (match?.groups?.url !== undefined) {
          resolve(match.groups.url);
        }
      });
    });

    if (child.pid === undefined) {
      child.kill("SIGKILL");

      throw new Error("the local browser has no process id");
    }

    const record: SessionRecord = {
      attemptId: input.attemptId,
      cdpUrl,
      pid: child.pid,
      sessionId,
      startedAt: clock.now(),
    };

    await writeFile(recordFile(sessionDirectory, sessionId), JSON.stringify(record), "utf8");

    return {
      cdpUrl,
      close: async () => {
        await stopPid(record.pid, clock);
        await rm(recordFile(sessionDirectory, sessionId), { force: true });

        return {
          browserMs: Math.max(0, clock.now() - record.startedAt),
          costMicros: 0,
          proxyBytes: 0,
        };
      },
      liveViewUrl: null,
      sessionId,
    };
  }

  async function listOpen() {
    let names: string[];

    try {
      names = await readdir(sessionDirectory);
    } catch {
      return [];
    }

    const files = names.filter((name) => name.endsWith(".json"));

    const found = await Promise.all(
      files.map(async (name) => {
        const record = await readRecord(sessionDirectory, name.replace(/\.json$/u, ""));

        if (record === null) {
          return null;
        }

        if (!alive(record.pid)) {
          await rm(recordFile(sessionDirectory, record.sessionId), { force: true });

          return null;
        }

        return { attemptId: record.attemptId, sessionId: record.sessionId };
      }),
    );

    return found.flatMap((session) => (session === null ? [] : [session]));
  }

  async function stop(sessionId: string) {
    const record = await readRecord(sessionDirectory, sessionId);

    if (record !== null) {
      await stopPid(record.pid, clock);
      await rm(recordFile(sessionDirectory, sessionId), { force: true });
    }
  }

  async function view(sessionId: string) {
    const record = await readRecord(sessionDirectory, sessionId);

    if (record === null) {
      return null;
    }

    return {
      liveViewUrl: null,
      recordingUrl: null,
      status: alive(record.pid) ? ("active" as const) : ("stopped" as const),
    };
  }

  return {
    id: "local",
    deleteProfile,
    ensureProfile,
    listOpen,
    open,
    stop,
    view,
  } satisfies BrowserProvider;
}

export type LocalBrowserProvider = ReturnType<typeof createLocalBrowserProvider>;
