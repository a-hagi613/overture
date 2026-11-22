import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { createInterceptionServer } from "../../src/server/platform/outbound-interception.ts";
import { createStreamConsole } from "../../src/server/probe/console.ts";
import type { ProbeConsole } from "../../src/server/probe/console.ts";
import { recordedBrowserUseHandlers } from "./browser-use-records.fixture.ts";
import type { BrowserUseApiState } from "./browser-use-records.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";
import { startWorkableFixture } from "./workable.fixture.ts";
import type { WorkableFixture } from "./workable.fixture.ts";
import { launchLocalChromium } from "./local-chromium.fixture.ts";
import type { LocalChromium } from "./local-chromium.fixture.ts";

export interface ProbeHarness {
  fixture: GreenhouseFixture;
  workable: WorkableFixture;
  chromium: LocalChromium;
  browserUse: BrowserUseApiState;
  server: ReturnType<typeof createInterceptionServer>;
  databasePath: string;
  resumePath: string;
  console: ProbeConsole;
  input: PassThrough;
  output: PassThrough;
  directory: string;
  close: () => void;
}

export const resumeBytes = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x70, 0x72, 0x6f, 0x62, 0x65,
]);

export async function startProbeHarness() {
  const directory = mkdtempSync(join(tmpdir(), "overture-probe-"));
  const resumePath = join(directory, "probe-resume.pdf");

  await Bun.write(resumePath, resumeBytes);

  const fixture = startGreenhouseFixture();
  const workable = startWorkableFixture();
  const chromium = await launchLocalChromium();
  const { handlers, state } = recordedBrowserUseHandlers(chromium.cdpUrl);

  const server = createInterceptionServer(...handlers);

  server.listen();

  const input = new PassThrough();
  const output = new PassThrough();

  return {
    fixture,
    workable,
    chromium,
    browserUse: state,
    server,
    databasePath: join(directory, "probe.db"),
    resumePath,
    directory,
    console: createStreamConsole(input, output),
    input,
    output,
    close: () => {
      server.close();
      fixture.close();
      workable.close();
      chromium.close();
    },
  } satisfies ProbeHarness;
}
