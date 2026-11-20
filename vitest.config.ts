import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/server/billing/ledger.test.ts",
      "src/server/platform/crypto/crypto.test.ts",
      "src/server/dispatch/planner.test.ts",
      "src/server/profile/address.test.ts",
      "src/server/catalog/tag-rules.test.ts",
      "src/server/catalog/question-normalize.test.ts",
    ],
    passWithNoTests: true,
  },
});
