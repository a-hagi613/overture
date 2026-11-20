import type { Clock } from "../../platform/ports/clock.ts";
import type { Env } from "../../config/env.ts";

import { createLocalBrowserProvider } from "./local.ts";

export function createBrowserProvider(env: Env, clock: Clock) {
  if (env.BROWSER_PROVIDER === undefined) {
    return null;
  }

  if (env.BROWSER_PROVIDER === "local") {
    return createLocalBrowserProvider({
      clock,
      sessionDirectory: env.BROWSER_SESSION_DIR ?? "data/browsers",
    });
  }

  throw new Error(
    `BROWSER_PROVIDER=${env.BROWSER_PROVIDER} is not implemented on this branch; the Browser Use and Kernel adapters arrive with issue 35`,
  );
}
