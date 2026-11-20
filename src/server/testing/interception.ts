import { setupServer } from "msw/node";

export function startInterception() {
  const server = setupServer();

  server.listen({ onUnhandledRequest: "error" });
}
