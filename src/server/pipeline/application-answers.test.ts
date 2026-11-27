import { describe, expect, test } from "bun:test";

import { openCountingDatabase } from "../testing/query-counter.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";
import {
  applicationAnswers,
  applications,
  facts,
  questions,
  users,
} from "../platform/db/schema.ts";
import { readScopedAnswers, scopedAnswer } from "./application-answers.ts";

const NOW = 1_795_000_000_000;
const USER = "scoped-answer-user";
const APPLICATION = "app-scoped";
const QUESTION = "q-scoped";

function seeded() {
  const { db } = openCountingDatabase();
  const personal = createPersonalCrypto(db, masterKeyringFor(new Uint8Array(32).fill(9)));
  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Scoped Owner",
      email: "scoped@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    })
    .run();

  db.insert(questions)
    .values({
      answerKind: "unknown",
      createdAt: NOW,
      fieldType: "text",
      id: QUESTION,
      textDisplay: "Are you comfortable with a weekly on-call rotation?",
      textNormHash: "q-scoped",
    })
    .run();

  db.insert(applications)
    .values({
      companyId: "company-scoped",
      companyName: "Northwind",
      companyNameNorm: "northwind",
      createdAt: NOW,
      id: APPLICATION,
      origin: "pick",
      postingId: "posting-scoped",
      postingTitle: "Platform Engineer",
      postingUrl: "https://example.test/job-scoped",
      status: "needs_review",
      updatedAt: NOW,
      userId: USER,
    })
    .run();

  return { db, personal };
}

async function saveAnswer(
  deps: ReturnType<typeof seeded>,
  input: { kind: "fact" | "open_text"; questionId?: string; value: string },
) {
  const id = crypto.randomUUID();

  const sealed = await deps.personal.sealFor(
    USER,
    { column: "sentences_enc", rowId: id, table: "application_answers" },
    JSON.stringify([{ byUser: true, resumeLineIds: [], sentence: input.value }]),
  );

  deps.db
    .insert(applicationAnswers)
    .values({
      applicationId: APPLICATION,
      createdAt: NOW,
      id,
      kind: input.kind,
      questionId: input.questionId ?? QUESTION,
      sentencesEnc: sealed,
      updatedAt: NOW,
      userId: USER,
      wordCount: input.value.split(/\s+/u).length,
    })
    .run();
}

describe("answers saved for one Application", () => {
  test("reads the fact answer for its Application and leaves global facts empty", async () => {
    const deps = seeded();

    await saveAnswer(deps, { kind: "fact", value: "Yes" });

    const answers = await readScopedAnswers(
      { db: deps.db, personal: deps.personal },
      { applicationId: APPLICATION, userId: USER },
    );

    expect(answers.get(QUESTION)).toBe("Yes");
    expect(deps.db.select().from(facts).all()).toEqual([]);
  });

  test("ignores open-text rows, which keep their own per-Application path", async () => {
    const deps = seeded();

    await saveAnswer(deps, { kind: "open_text", value: "Because the product matters to me." });

    const answers = await readScopedAnswers(
      { db: deps.db, personal: deps.personal },
      { applicationId: APPLICATION, userId: USER },
    );

    expect(answers.size).toBe(0);
  });

  test("resolves a valid scoped answer and rejects one that does not fit the field", () => {
    const question = {
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Will you need sponsorship?",
      questionId: QUESTION,
    } as const;

    expect(scopedAnswer("No", question)).toMatchObject({ kind: "answer", value: "No" });
    expect(scopedAnswer("Maybe", question)).toBeNull();
    expect(scopedAnswer(undefined, question)).toBeNull();
  });
});
