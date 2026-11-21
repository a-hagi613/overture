import type { AppServer } from "./app-server.ts";

import { expectBoardToMatch } from "./legal-board.ts";
import { startFreshAppServer, test as appTest } from "./app.fixture.ts";

const test = appTest.extend<{ legalServer: AppServer }>({
  legalServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test(`the Privacy Policy page matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      legalServer,
    }) => {
      await expectBoardToMatch({
        browser,
        height: width === 1280 ? 500 : 430,
        heading: "Privacy Policy",
        name: `${String(width)}-${theme}`,
        referenceDir: new URL("../../design/reference/privacy/", import.meta.url),
        path: "/privacy",
        theme,
        url: legalServer.url,
        width,
      });
    });
  }
}
