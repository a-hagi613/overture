import { test } from "./admin.fixture.ts";
import { chunksFor, runSweep, themes, widths } from "./interactive-sweep.ts";

test.describe.configure({ timeout: 240_000 });

for (const width of widths) {
  for (const theme of themes) {
    for (const chunk of chunksFor("admin")) {
      test(`G3/G7 every admin route at ${String(width)} ${theme} (group ${chunk + 1})`, async ({
        adminAppUrl,
        appServerUrl,
        browser,
        chromeOwnerStorage,
        ownerAccessCookieState,
      }) => {
        await runSweep(
          "admin",
          width,
          theme,
          { adminAppUrl, appServerUrl, browser, chromeOwnerStorage, ownerAccessCookieState },
          chunk,
        );
      });
    }
  }
}
