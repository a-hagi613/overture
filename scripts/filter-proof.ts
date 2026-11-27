import { writeFileSync } from "node:fs";

import {
  filterProofMarkdown,
  loadRecordedPull,
  runFilterProof,
} from "../src/server/jobs/filter-proof.ts";

const FIXTURE = "src/server/jobs/fixtures/filter-proof/freehire-pull-2026-11-26.json.gz";
const REPORT = "docs/research/685-filter-proof.md";

if (import.meta.main) {
  const records = loadRecordedPull(FIXTURE);
  const result = runFilterProof(records);
  const markdown = filterProofMarkdown(result);

  writeFileSync(REPORT, markdown);
  process.stdout.write(markdown);
  process.stdout.write(`\nWrote ${REPORT}\n`);

  if (result.wrongFieldRate > 0.03) {
    process.exitCode = 1;
  }
}
