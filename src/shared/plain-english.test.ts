import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { copy } from "./copy.ts";

const FORBIDDEN = [
  { label: '"Facts" or "Fact"', pattern: /\bFacts?\b/u },
  { label: '"Personal Details"', pattern: /Personal Details/u },
  { label: '"Invite grant"', pattern: /Invite grant/iu },
  { label: 'headline "Sent via …"', pattern: /\bSent via\b/u },
  {
    label: 'headline "via <hiring system>"',
    pattern:
      /\bvia (?:Greenhouse|Lever|Ashby|SmartRecruiters|Personio|Workable|Recruitee|BambooHR|Teamtailor|Zoho|Hireology|Breezy|Pinpoint|Softgarden)\b/u,
  },
  { label: '"Waiting on a Review"', pattern: /Waiting on a Review/u },
] as const;

const EXCLUDED_TOP_LEVEL_COPY = new Set(["admin", "legal"]);

const EXCLUDED_WEB = [
  "/routes/admin/",
  "routes/terms.tsx",
  "routes/privacy.tsx",
  "components/legal-",
];

function userFacingCopy() {
  return JSON.stringify(
    Object.fromEntries(Object.entries(copy).filter(([key]) => !EXCLUDED_TOP_LEVEL_COPY.has(key))),
  );
}

function webSources() {
  return readdirSync("src/web", { encoding: "utf8", recursive: true }).flatMap((entry) => {
    const file = join("src/web", entry);
    const readable = file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".css");
    const excluded = EXCLUDED_WEB.some((suffix) => file.includes(suffix));

    return readable && !excluded ? [file] : [];
  });
}

function findingsIn(text: string) {
  return FORBIDDEN.flatMap((entry) => (entry.pattern.test(text) ? [entry.label] : []));
}

describe("the plain-English copy sweep", () => {
  test("no user-facing copy string keeps a developer word", () => {
    const text = userFacingCopy();

    expect(findingsIn(text).map((label) => `${label}: ${text.slice(0, 120)}`)).toEqual([]);
  });

  test("no landing or signed-in component keeps a developer word", () => {
    const findings = webSources().flatMap((file) => {
      const text = readFileSync(file, "utf8");

      return findingsIn(text).map((label) => `${file}: ${label}`);
    });

    expect(findings).toEqual([]);
  });

  test("the marketing copy module is swept too", () => {
    expect(findingsIn(readFileSync("src/shared/marketing-copy.ts", "utf8"))).toEqual([]);
  });

  test("the send line names the company, never the hiring system", () => {
    expect(copy.board.dossier.sentVia("Halden Systems", "12:00")).toBe(
      "Sent directly to Halden Systems’ careers page · 12:00",
    );
  });

  test("no stage label is called Waiting", () => {
    expect(Object.values(copy.stages)).not.toContain("Waiting");
    expect(Object.values(copy.board.lanes)).not.toContain("Waiting");
    expect(copy.board.timeline.needsReview).toBe("Needs your answer");
  });
});
