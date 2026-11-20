import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export default function globalSetup() {
  mkdirSync("test/e2e/.tmp", { recursive: true });

  const result = spawnSync(
    "bun",
    ["run", "scripts/create-template-db.ts", "test/e2e/.tmp/template.db"],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`template database creation failed: ${result.stderr}`);
  }
}
