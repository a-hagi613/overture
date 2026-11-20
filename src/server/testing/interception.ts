import { http, passthrough } from "msw";
import { setupServer } from "msw/node";

import { env } from "../config/env.ts";

export function startInterception() {
  const server = setupServer(
    http.get(
      `${env.GREENHOUSE_FEED_BASE_URL ?? "https://boards-api.greenhouse.io"}/v1/boards/:token/jobs`,
      () => passthrough(),
    ),
    http.get(
      `${env.GREENHOUSE_FEED_BASE_URL ?? "https://boards-api.greenhouse.io"}/v1/boards/:token/jobs/:jobId`,
      () => passthrough(),
    ),
  );

  server.listen({ onUnhandledRequest: "error" });
}
