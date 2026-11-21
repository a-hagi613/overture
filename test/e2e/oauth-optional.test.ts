import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { authTestIdentity } from "./auth.fixture.ts";
import {
  emailOnlyEnvironment,
  expect,
  startFreshAppServer,
  test as appTest,
} from "./app.fixture.ts";
import { serverEnvironment } from "./app-server.ts";
import type { AppServer } from "./app-server.ts";
import { latestMailLink, verifyAuthState } from "./sign-in.ts";

const emailOnlyTest = appTest.extend<{ emailOnlyServer: AppServer }>({
  emailOnlyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, emailOnlyEnvironment);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

emailOnlyTest(
  "with both OAuth pairs unset the sign-in screen offers only the emailed link, and the link signs the owner in",
  async ({ page, request, emailOnlyServer }) => {
    await page.goto(`${emailOnlyServer.url}/signin`);

    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with LinkedIn" })).toHaveCount(0);

    await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("Link sent to")).toBeVisible();

    const link = await latestMailLink(emailOnlyServer.url, request, authTestIdentity.ownerEmail);

    await page.goto(link);
    await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

    const state = await verifyAuthState(emailOnlyServer.url, request);

    expect(state.users.at(-1)?.role).toBe("owner");
    expect(state.sessions).toHaveLength(1);
    expect(state.accounts.map((account) => account.providerId)).not.toContain("google");
    expect(state.accounts.map((account) => account.providerId)).not.toContain("linkedin");
  },
);

appTest(
  "a single OAuth name without its pair stops the server at boot and names the missing one",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "overture-e2e-boot-"));

    const child = spawn("bun", ["run", "src/server/main.ts"], {
      env: {
        ...serverEnvironment({ GOOGLE_CLIENT_SECRET: "" }),
        DATABASE_URL: join(directory, "overture.db"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      let stderr = "";

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("exit", (code) => {
        resolve({ code, stderr });
      });
    });

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are optional only as a pair",
    );
  },
);
